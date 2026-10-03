/**
 * Backfill de l'identite de jeu issue d'IGDB.
 *
 * L'import normal ne fait que de la fraicheur (updated_at > checkpoint), donc
 * les jeux deja presents ne recevront jamais game_type / parent_game_name /
 * version_parent_name / official_url / store_url. Ce script comble ce manque:
 *
 *  - lit les jeux de Neon dont un de ces champs manque;
 *  - interroge IGDB par lots (limite API: 4 requetes/seconde);
 *  - ecrit dans Neon puis dans Turso (Turso est la base de lecture du site).
 *
 * Idempotent: on ne cible que les lignes incompletes, et chaque ecriture est
 * faite par igdb_id, donc relancer apres une interruption reprend ou il faut.
 */
import axios from 'axios';
import { sql, eq } from 'drizzle-orm';
import { createNeonClient, createTursoClient } from './db/client.js';
import { medias } from './db/neon/schema.js';
import { medias as tursoMedias } from './db/turso/schema.js';
import { createLog } from './utils/log.js';

const IGDB_URL = 'https://api.igdb.com/v4/games';
const FIELDS = 'fields id,name,game_type,parent_game.name,version_parent.name,websites.url,websites.category';
const ID_BATCH = 40;        // corps de requete maintenu court
const RATE_DELAY_MS = 350;   // ~3 requetes/s, sous la limite de 4/s

const log = createLog('Backfill IGDB', 'backfill');

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

async function getToken(clientId: string, clientSecret: string): Promise<string> {
    const r = await axios.post(
        'https://id.twitch.tv/oauth2/token',
        null,
        {
            params: { client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' },
            timeout: 20000,
        }
    );
    return r.data.access_token;
}

async function fetchBatch(token: string, ids: number[]): Promise<any[]> {
    const body = `${FIELDS}; where id = (${ids.join(',')});`;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const r = await axios.post(IGDB_URL, body, {
                headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${token}` },
                timeout: 25000,
            });
            return r.data || [];
        } catch (e: any) {
            const status = e?.response?.status;
            if (status === 429 || status >= 500) {
                await sleep(1200 * (attempt + 1));
                continue;
            }
            throw e;
        }
    }
    return [];
}

/** Cible les jeux dont au moins un champ d'identite manque. */
const NEEDED = sql`
    type = 'jeu'
    AND igdb_id IS NOT NULL
    AND (game_type IS NULL OR parent_game_name IS NULL OR official_url IS NULL)
`;

async function main() {
    const neonUrl = process.env.NEON_DATABASE_URL || '';
    const tursoUrl = process.env.TURSO_DATABASE_URL || '';
    const tursoToken = process.env.TURSO_AUTH_TOKEN || '';
    const clientId = process.env.TWITCH_CLIENT_ID || '';
    const clientSecret = process.env.TWITCH_CLIENT_SECRET || '';

    if (!neonUrl || !clientId || !clientSecret) {
        log.error('Configuration incomplete (NEON_DATABASE_URL / TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET)');
        process.exitCode = 1;
        return;
    }

    const neon = createNeonClient(neonUrl);
    const turso = tursoUrl && tursoToken ? createTursoClient(tursoUrl, tursoToken) : null;
    const token = await getToken(clientId, clientSecret);

    // Pagination par id pour tenir en memoire: 3930 lignes, on evite le skip.
    let lastId = 0;
    const PAGE = 500;
    const LIMIT = parseInt(process.env.BACKFILL_LIMIT || '0', 10) || 0;
    let scanned = 0;
    let updated = 0;
    let missing = 0;
    let page = 0;

    while (true) {
        if (LIMIT > 0 && scanned >= LIMIT) {
            log.info(`Limite atteinte (${LIMIT}), arret propre`);
            break;
        }
        const rows = await neon.select({
            id: medias.id,
            igdbId: medias.igdbId,
            title: medias.title,
        })
            .from(medias)
            .where(sql`${NEEDED} AND id > ${lastId} ORDER BY id ASC LIMIT ${PAGE}`);

        if (rows.length === 0) break;
        lastId = rows[rows.length - 1].id as any;
        scanned += rows.length;
        page++;
        log.info(`Page ${page}: ${rows.length} jeux a traiter (total scanne ${scanned})`);

        const byIgdb = new Map<number, typeof rows[number]>();
        const ids: number[] = [];
        for (const r of rows) {
            if (r.igdbId && !byIgdb.has(r.igdbId)) {
                byIgdb.set(r.igdbId, r);
                ids.push(r.igdbId);
            }
        }

        for (let i = 0; i < ids.length; i += ID_BATCH) {
            const slice = ids.slice(i, i + ID_BATCH);
            const data = await fetchBatch(token, slice);
            if (i > 0) await sleep(RATE_DELAY_MS);

            for (const g of data) {
                const row = byIgdb.get(g.id);
                if (!row) continue;
                const official = (g.websites || []).find((w: any) => w?.category === 1 && w?.url);
                const store = (g.websites || []).find((w: any) => w?.category === 2 && w?.url);

                await neon.update(medias)
                    .set({
                        gameType: typeof g.game_type === 'number' ? g.game_type : null,
                        parentGameName: g.parent_game?.name || null,
                        versionParentName: g.version_parent?.name || null,
                        officialUrl: official?.url || null,
                        storeUrl: store?.url || null,
                        metadataFreshAt: new Date(),
                    })
                    .where(eq(medias.id, row.id));

                if (turso) {
                    // Turso n'a que les lignes deja presentes; on insere/actualise
                    // par id plutot que UPDATE, pour ne pas creer de ligne absente.
                    try {
                        const existing = await turso.select({ id: tursoMedias.id })
                            .from(tursoMedias).where(eq(tursoMedias.id, row.id)).limit(1);
                        if (existing.length > 0) {
                            await turso.update(tursoMedias).set({
                                gameType: typeof g.game_type === 'number' ? g.game_type : null,
                                parentGameName: g.parent_game?.name || null,
                                versionParentName: g.version_parent?.name || null,
                                officialUrl: official?.url || null,
                                storeUrl: store?.url || null,
                            }).where(eq(tursoMedias.id, row.id));
                        }
                    } catch (e: any) {
                        log.warn(`Turso update echoue pour ${row.title}: ${String(e.message).slice(0, 80)}`);
                    }
                }
                updated++;
            }

            // un igdb_id present en base mais absent de l'IGDB repond
            const answered = new Set(data.map((g: any) => g.id));
            for (const id of slice) {
                if (!answered.has(id)) missing++;
            }
        }
        log.info(`Cumul: ${updated} mis a jour, ${missing} introuvables dans IGDB`);
    }

    log.success(`Backfill termine: ${scanned} scannes, ${updated} mis a jour, ${missing} introuvables`);
}

main().catch((e) => {
    log.error(`Backfill en echec: ${e?.message || e}`);
    process.exitCode = 1;
});
