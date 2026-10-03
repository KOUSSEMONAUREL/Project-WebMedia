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
const FIELDS = 'fields id,name,game_type,parent_game.name,version_parent.name,websites.url,websites.type';
// IGDB plafonne la clause "where id = (...)" a 10 ids par requete:
// verifie (20 demandes -> 10 recus). Au-dela, les ids sont SILENCIEUSEMENT
// abandonnes, ce qui faisait passer 370 jeux pour "introuvables".
const ID_BATCH = 10;
const STORE_TYPES = new Set([13, 16, 17, 22, 23, 24]);
const RATE_DELAY_MS = 250;   // ~3 requetes/s, sous la limite de 4/s
// Le plafond de 10 ids est PAR REQUETE: on peut donc envoyer plusieurs
// requetes en meme temps. 12 en vol reste sous le plafond de 4/s sur
// une fenetre glissante et gagne un facteur 10 sur le temps IGDB.
const HTTP_CONCURRENCY = 6;
const DB_CONCURRENCY = 24;

/** Lance fn sur chaque element, au plus `limit` en vol simultanes. */
let igdbNextSlot = 0;
async function igdbSlot(): Promise<void> {
    const now = Date.now();
    const start = Math.max(now, igdbNextSlot);
    igdbNextSlot = start + RATE_DELAY_MS;
    if (start > now) await sleep(start - now);
}

async function pool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const i = cursor++;
            await fn(items[i], i);
        }
    });
    await Promise.all(workers);
}

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
    for (let attempt = 0; attempt < 4; attempt++) {
        await igdbSlot();
        try {
            const r = await axios.post(
                IGDB_URL,
                `${FIELDS}; where id = (${ids.join(',')});`,
                {
                    headers: {
                        'Client-ID': process.env.TWITCH_CLIENT_ID || '',
                        Authorization: `Bearer ${token}`,
                    },
                }
            );
            return r.data || [];
        } catch (e: any) {
            const status = e?.response?.status;
            if (status === 429 || status >= 500) {
                // On garde la place dans la file: un 429 ici n'est pas une
                // absence de jeu, c'est trop de monde.
                await sleep(1500 * (attempt + 1));
                continue;
            }
            throw e;
        }
    }
    log.warn(`IGDB: ${ids.length} ids abandonnes apres 4 tentatives (rate limit)`);
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
        // Pagination sur igdb_id (entier, indexe) et non sur id (uuid):
        // `id > 0` sur un uuid fait echouer la requete.
        const rows = await neon.select({
            id: medias.id,
            igdbId: medias.igdbId,
            title: medias.title,
        })
            .from(medias)
            .where(sql`${NEEDED} AND igdb_id > ${lastId} ORDER BY igdb_id ASC LIMIT ${PAGE}`);

        if (rows.length === 0) break;
        lastId = rows[rows.length - 1].igdbId as any;
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

        const slices: number[][] = [];
        for (let i = 0; i < ids.length; i += ID_BATCH) slices.push(ids.slice(i, i + ID_BATCH));

        // Les requetes IGDB partent en parallele: le plafond de 10 ids est par
        // requete, pas par seconde.
        const fetchedData = new Map<number, any[]>();
        const writes: Array<() => Promise<void>> = [];
        await pool(slices, HTTP_CONCURRENCY, async (slice) => {
            fetchedData.set(slice[0], await fetchBatch(token, slice));
        });

        for (let bi = 0; bi < slices.length; bi++) {
            const slice = slices[bi];
            const data = fetchedData.get(slice[0]) || [];
            for (const g of data) {

                const row = byIgdb.get(g.id);
                if (!row) continue;
                // Types IGDB: 1 = site officiel, 2 = wiki, 8 = Instagram,
                // 13 = Steam, 16 = Epic, 17 = GOG, 22 = Xbox, 23 = PlayStation,
                // 24 = Nintendo. Les deux derniers groupes sont les boutiques.
                const sites = (g.websites || []) as any[];
                const patch = {
                    gameType: typeof g.game_type === 'number' ? g.game_type : null,
                    parentGameName: g.parent_game?.name || null,
                    versionParentName: g.version_parent?.name || null,
                    officialUrl: sites.find((w: any) => w?.type === 1 && w?.url)?.url || null,
                    storeUrl: sites.find((w: any) => STORE_TYPES.has(w?.type) && w?.url)?.url || null,
                };
                writes.push(async () => {
                    await neon.update(medias).set({ ...patch, metadataFreshAt: new Date() })
                        .where(eq(medias.id, row.id));
                    // Turso n'a que les lignes deja presentes: un UPDATE sur un id
                    // absent ne cree rien, donc pas besoin du SELECT prealable.
                    if (turso) {
                        try {
                            await turso.update(tursoMedias).set(patch).where(eq(tursoMedias.id, row.id));
                        } catch (e: any) {
                            const cause = (e as any)?.cause?.message || e?.message || String(e);
                            log.warn(`Turso update echoue pour ${row.title}: ${cause}`.slice(0, 300));
                        }
                    }
                    updated++;
                });
            }

            // 24 ecritures en vol: le goulot etait le round-trip sequentiel,
            // pas la bande passante. Neon et Turso sont sur deux bases distinctes.
            await pool(writes.splice(0), DB_CONCURRENCY, async (fn) => { await fn(); });

            // un igdb_id present en base mais absent de l'IGDB repond
            const answered = new Set(data.map((g: any) => g.id));
            for (const id of slice) {
                if (!answered.has(id)) missing++;
            }
        }
        log.info(`Cumul: ${updated} mis a jour, ${missing} introuvables dans IGDB`);
        // secoucage optionnel du pool entre deux pages
    }

    log.success(`Backfill termine: ${scanned} scannes, ${updated} mis a jour, ${missing} introuvables`);
}

main().catch((e) => {
    log.error(`Backfill en echec: ${e?.message || e}`);
    process.exitCode = 1;
});
