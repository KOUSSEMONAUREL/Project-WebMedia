import 'dotenv/config';
import { MongoClient, type Collection, type Document } from 'mongodb';

/**
 * Garde-fou de retention de la collection `logs`.
 *
 * Pourquoi un garde-fou et non un job de purge : MongoDB purge nativement via un index TTL,
 * et ce purgeur tourne en continu, toutes les ~60s. Un DELETE hebdomadaire ou mensuel par
 * dessus serait redondant : il consommerait du credit d'operations pour recreer ce que le
 * TTL fait deja, et sur un cluster M0 gratuit (512 Mo) chaque ecriture compte.
 *
 * Ce qui peut casser, en revanche, c'est que l'index TTL DISPARAISSE (base recreee, index
 * perdu lors d'un import, valeur modifiee par erreur). La collection contredit alors la
 * regle de retention : plus rien ne disparait, la collection grossit jusqu'a saturer le
 * free tier, et comme la connexion Mongo ne se fait que sur un ecritif, rien ne signale
 * l'incident. D'ou ce controle : il recree l'index s'il manque, et echoue bruyamment.
 */

const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 jours
const FREE_TIER_BYTES = 512 * 1024 * 1024; // M0 gratuit : 512 Mo
const WARN_BYTES = FREE_TIER_BYTES * 0.75; // 384 Mo
const FAIL_BYTES = FREE_TIER_BYTES * 0.9; // 460 Mo

function mb(bytes: number): string {
    return `${(bytes / 1024 / 1024).toFixed(2)} Mo`;
}

function findTtlIndex(indexes: Document[]): Document | undefined {
    return indexes.find(
        (idx) =>
            idx.key?.timestamp === 1 &&
            idx.expireAfterSeconds !== undefined &&
            idx.expireAfterSeconds !== null
    );
}

async function ensureTtlIndex(logs: Collection<Document>): Promise<string> {
    const indexes = await logs.indexes() as Document[];
    const existing = findTtlIndex(indexes);

    if (!existing) {
        await logs.createIndex({ timestamp: 1 }, { expireAfterSeconds: TTL_SECONDS });
        return 'index TTL absent -> cree (7j)';
    }

    if (existing.expireAfterSeconds === TTL_SECONDS) {
        return `index TTL present (${existing.expireAfterSeconds}s)`;
    }

    // TTL existant mais different : le laisser en place garderait une retention qui ne
    // correspond plus a la regle. On le recree explicitement plutot que de diverger.
    await logs.dropIndex(existing.name);
    await logs.createIndex({ timestamp: 1 }, { expireAfterSeconds: TTL_SECONDS });
    return `index TTL corrige (${existing.expireAfterSeconds}s -> ${TTL_SECONDS}s)`;
}

async function check() {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI missing');

    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
    await client.connect();

    try {
        const logs = client.db().collection('logs');

        const ttlStatus = await ensureTtlIndex(logs);
        console.log(`Mongo: ${ttlStatus}`);

        const count = await logs.countDocuments();
        const oldest = await logs.find().sort({ timestamp: 1 }).limit(1).toArray();
        const newest = await logs.find().sort({ timestamp: -1 }).limit(1).toArray();
        const format = (doc?: Document) =>
            doc?.timestamp instanceof Date ? doc.timestamp.toISOString() : '-';
        console.log(`Mongo: ${count} logs, du ${format(oldest[0])} au ${format(newest[0])}`);

        let size = 0;
        try {
            const stats = await client.db().command({ collStats: 'logs' });
            size = stats.size ?? 0;
        } catch {
            // collStats echoue si la collection n'existe pas encore : la base est vide.
            console.log('Mongo: collection logs absente, rien a surveiller');
            return;
        }

        console.log(`Mongo: logs occupe ${mb(size)} / ${mb(FREE_TIER_BYTES)} (M0 gratuit)`);

        if (size > FAIL_BYTES) {
            throw new Error(
                `logs occupe ${mb(size)}, au-dessus du seuil de ${mb(FAIL_BYTES)}. ` +
                    `Verifier si l'index TTL est bien sur 'timestamp'.`
            );
        }
        if (size > WARN_BYTES) {
            console.warn(`Mongo: logs au-dessus du seuil d'alerte (${mb(WARN_BYTES)})`);
        }

        // Derniere ligne de defense : si le TTL est en place, tout document plus vieux que
        // la fenetre est un document que le TTL n'a pas encore rattrape. Il se signale seul.
        const cutoff = Date.now() - TTL_SECONDS * 1000;
        if (newest[0]?.timestamp instanceof Date && newest[0].timestamp.getTime() < cutoff) {
            console.warn(
                `Mongo: aucun log depuis plus de ${TTL_SECONDS / 86400}j. ` +
                    `Soit le logger est inactif, soit c'est attendu (aucun evenement audit).`
            );
        }
    } finally {
        await client.close();
    }
}

check()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Echec du controle de retention Mongo:', err instanceof Error ? err.message : err);
        process.exit(1);
    });