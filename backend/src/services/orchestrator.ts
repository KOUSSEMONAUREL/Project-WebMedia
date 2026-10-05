import { getSupabaseHttpClient, getNeonDb } from "../db/singleton";
import { medias } from "../db/neon/schema";
import { inArray } from 'drizzle-orm';
import { logger } from "./logger";

const DAY_MS = 24 * 3600000;

/** Fenetre glissante d'analyse des echecs. Au-dela, le compteur repart de zero tout seul. */
const FAILURE_WINDOW_MS = 30 * DAY_MS;

/** Echecs "permanents" (source disparue) requis pour retirer un media de la rotation active. */
const RETIRE_AFTER_PERMANENT = 5;

/** Retrait temporaire, pas definitif : la source peut repasser, on reessaie plus tard. */
const RETIRED_BACKOFF_MS = 30 * DAY_MS;

/** Plafond du backoff des erreurs transitoires pour ne pas hammering un media malade. */
const MAX_TRANSIENT_BACKOFF_MS = 7 * DAY_MS;

/**
 * Un echec permanent designe la source (media retire, 404) : le reessayer ne sert a rien.
 * Un echec transitoire designe notre pile (timeout, 429, erreur reseau, scraper casse) :
 * le media est sain, il faut juste reessayer plus tard, sinon un bug de deploiement
 * condamnerait tout le catalogue.
 */
const PERMANENT_FAILURE_RE = /\b(404|410|not[\s_-]?found|no[\s_-]?match|introuvable|doesn'?t exist|does not exist|deleted|removed|disponible\s?non)\b/i;

function isPermanentFailure(status: string | null, lastError: string | null): boolean {
    if (status === 'no_match') return true;
    if (!lastError) return false;
    return PERMANENT_FAILURE_RE.test(lastError);
}

interface FailureProfile {
    permanent: number;
    transient: number;
}

/**
 * Espacement entre deux passages d'un media. 24h quand tout va bien, puis double a chaque
 * echec, plafonne a 7 jours pour les erreurs transitoires, et 30 jours une fois le media
 * retire pour echecs permanents. La fonction est pure pour rester testable.
 */
function nextScrapeDelay(profile: FailureProfile | undefined): number {
    if (!profile) return DAY_MS;
    const { permanent, transient } = profile;
    if (permanent >= RETIRE_AFTER_PERMANENT) return RETIRED_BACKOFF_MS;
    const failures = permanent + transient;
    if (failures <= 0) return DAY_MS;
    return Math.min(Math.pow(2, failures) * DAY_MS, MAX_TRANSIENT_BACKOFF_MS);
}

export class OrchestratorService {
    private db: D1Database;
    private supabase: any;
    private neon: any;
    private kv: any;
    private mongoUri?: string;

    constructor(env: any) {
        this.db = env.DB;
        this.supabase = getSupabaseHttpClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
        this.neon = getNeonDb(env.NEON_DATABASE_URL, env.HYPERDRIVE);
        this.kv = env.KV;
        this.mongoUri = env.MONGODB_URI || process.env.MONGODB_URI;
    }

    async resolveStaleMedia() {
        if (this.kv) {
            const lastRun = await this.kv.get('orchestrator_last_run');
            if (lastRun && Date.now() - parseInt(lastRun) < 30 * 60 * 1000) {
                console.log("⏳ Orchestration sautée (trop tôt depuis le dernier run).");
                return { processed: 0, skipped: true };
            }
            await this.kv.put('orchestrator_last_run', Date.now().toString());
        }

        console.log("🚀 Starting Global Orchestration Cycle (Batch Mode)...");
        await logger.info('Orchestrator', 'Démarrage du cycle d\'orchestration', {}, this.mongoUri);
        const now = Date.now();

        // 1. UNE seule query D1 : récupère les médias à rafraîchir (LIMIT 100)
        const { results: staleMedia } = await this.db.prepare(`
            SELECT media_id, type, metadata_ok, title, slug
            FROM media_state
            WHERE next_scrape < ? AND type NOT IN ('book', 'film', 'serie', 'anime')
            ORDER BY next_scrape ASC
            LIMIT 200
        `).bind(now).all<{ media_id: string; type: string; metadata_ok: number; title: string | null; slug: string | null }>();

        if (staleMedia.length === 0) {
            console.log("✅ Aucun média stale trouvé.");
            return { processed: 0 };
        }

        // Filtrer ceux sans metadata_ok
        const readyMedia = staleMedia.filter(m => m.metadata_ok);
        if (readyMedia.length === 0) {
            console.log("⏳ Aucun média avec métadonnées prêtes.");
            return { processed: 0 };
        }

        const mediaIds = [...new Set(readyMedia.map(m => m.media_id))];

        // 2. UNE seule query Supabase : verifie les jobs existants pour tous les media_ids
        const { data: existingJobs, error: jobsError } = await this.supabase
            .from('scraping_jobs')
            .select('media_id')
            .in('media_id', mediaIds)
            .in('status', ['pending', 'processing']);

        if (jobsError) {
            console.error("Erreur verification jobs Supabase:", jobsError);
            return { processed: 0 };
        }

        const existingMediaIds = new Set((existingJobs || []).map((j: any) => j.media_id));

        // Profiler les echecs des 30 derniers jours, en distinguant ce qui vient de la source
        // (permanent) de ce qui vient de notre pile (transitoire). Un 'completed' ne compte
        // jamais : sinon un media scrape avec succes depuis des mois finit ecarte.
        const attemptWindow = new Date(now - FAILURE_WINDOW_MS).toISOString();
        const { data: recentJobs, error: attemptsError } = await this.supabase
            .from('scraping_jobs')
            .select('media_id, attempts, status, last_error')
            .in('media_id', mediaIds)
            .gte('created_at', attemptWindow);
        if (attemptsError) {
            console.error("Erreur lecture profil d'echecs:", attemptsError);
            return { processed: 0 };
        }

        const failureProfiles = new Map<string, FailureProfile>();
        for (const j of (recentJobs || [])) {
            if (j.status === 'completed') continue;
            const weight = j.attempts || 0;
            if (weight <= 0) continue;
            const profile = failureProfiles.get(j.media_id) || { permanent: 0, transient: 0 };
            if (isPermanentFailure(j.status, j.last_error)) profile.permanent += weight;
            else profile.transient += weight;
            failureProfiles.set(j.media_id, profile);
        }

        const retiredCount = [...failureProfiles.values()]
            .filter((p) => p.permanent >= RETIRE_AFTER_PERMANENT).length;
        if (retiredCount > 0) {
            console.warn(`${retiredCount} medias retires (>= ${RETIRE_AFTER_PERMANENT} echecs permanents sur 30j), backoff ${RETIRED_BACKOFF_MS / DAY_MS}j`);
        }

        // 3. Recupere title/slug : priorite D1 (stocke a l'ingest), fallback Neon avec retry
        const mediaInfoMap = new Map<string, { id: string; title: string; slug: string; parentGameName?: string | null }>();

        // 3a. D'abord, récupérer ceux qui ont déjà title/slug dans D1
        for (const m of readyMedia) {
            if (m.title && m.slug) {
                mediaInfoMap.set(m.media_id, { id: m.media_id, title: m.title, slug: m.slug });
            }
        }

        // 3a-bis. Valider que les UUIDs D1 existent dans Neon (supprime les stale)
        if (mediaInfoMap.size > 0) {
            const d1Ids = [...mediaInfoMap.keys()];
            try {
                const existingInNeon = await this.neon.select({ id: medias.id })
                    .from(medias)
                    .where(inArray(medias.id, d1Ids));
                const validIds = new Set(existingInNeon.map((m: any) => m.id));
                for (const id of d1Ids) {
                    if (!validIds.has(id)) {
                        mediaInfoMap.delete(id);
                        console.warn(`UUID stale retiré de D1: ${id}`);
                    }
                }
            } catch {
                console.warn('Neon indisponible pour validation UUIDs D1, skip');
            }
        }

        // 3b. Pour ceux sans title/slug dans D1, fallback Neon avec retry
        const missingFromD1 = readyMedia.filter(m => !mediaInfoMap.has(m.media_id));
        if (missingFromD1.length > 0) {
            const missingIds = [...new Set(missingFromD1.map(m => m.media_id))];
            const maxRetries = 3;
            let neonSuccess = false;
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    // Wake-up Neon avant la query
                    if (attempt > 0) await this.neon.execute('SELECT 1');
                    const mediaInfos = await this.neon.select({
                        id: medias.id,
                        title: medias.title,
                        slug: medias.slug,
                        parentGameName: medias.parentGameName
                    })
                        .from(medias)
                        .where(inArray(medias.id, missingIds));
                    for (const m of mediaInfos as any[]) {
                        mediaInfoMap.set(m.id, { id: m.id, title: m.title, slug: m.slug, parentGameName: m.parentGameName });
                    }
                    neonSuccess = true;
                    break;
                } catch (e: any) {
                    if (attempt < maxRetries) {
                        console.warn(`Neon query échouée (tentative ${attempt + 1}/${maxRetries}), retry dans 1s...`);
                        await new Promise(r => setTimeout(r, 1000));
                    } else {
                        console.error(`Neon query définitivement échouée après ${maxRetries} tentatives: ${e.message}`);
                    }
                }
            }
            if (!neonSuccess) {
                console.warn(`${missingFromD1.length} médias sans title/slug dans D1 seront ignorés ce cycle`);
            }
        }

        // 4. Construire les batchs pour les inserts + updates
        const insertValues: any[] = [];
        // Deux lots distincts : les medias ecartes sont repousses immediatement, les medias
        // retenus seulement apres insertion reussie (retry preserve si Supabase echoue).
        // Tout media ecarte DOIT etre repousse : sinon il conserve le plus vieux next_scrape et
        // la selection ORDER BY next_scrape ASC LIMIT 200 le remet en tete a chaque cycle.
        const deferStatements: any[] = [];
        const jobStatements: any[] = [];

        const pushScrapeUpdate = (bucket: any[], at: number, mediaId: string) =>
            bucket.push(
                this.db.prepare(`UPDATE media_state SET next_scrape = ? WHERE media_id = ?`).bind(at, mediaId)
            );

        for (const media of readyMedia) {
            const { media_id, type } = media;
            const profile = failureProfiles.get(media_id);
            const scheduledAt = now + nextScrapeDelay(profile);

            const mediaInfo = mediaInfoMap.get(media_id);
            const isStreaming = type === 'film' || type === 'serie' || type === 'anime';
            const workerType =
                type === 'jeu' ? 'playwright' :
                type === 'novel' ? 'novel' :
                (type === 'webtoon' || type === 'comic' || type === 'manga') ? 'webtoon' :
                null;

            const eligible =
                !existingMediaIds.has(media_id) &&
                (profile?.permanent || 0) < RETIRE_AFTER_PERMANENT &&
                !!mediaInfo &&
                type !== 'book' &&
                !isStreaming &&
                !!workerType;

            if (!eligible) {
                pushScrapeUpdate(deferStatements, scheduledAt, media_id);
                continue;
            }

            insertValues.push({
                media_id: media_id,
                media_type: type,
                worker_type: workerType,
                title: mediaInfo!.title,
                slug: mediaInfo!.slug,
                parent_game_name: mediaInfo!.parentGameName || null,
                status: 'pending',
                priority: 1
            });

            pushScrapeUpdate(jobStatements, scheduledAt, media_id);
        }

        const BATCH_SIZE = 100;
        const runScrapeUpdates = async (statements: any[]) => {
            for (let i = 0; i < statements.length; i += BATCH_SIZE) {
                await this.db.batch(statements.slice(i, i + BATCH_SIZE));
            }
        };

        // 5. Repousser les medias ecartes AVANT tout return : ils ne dependent pas de l'insert,
        // et sans cela un cycle qui ne cree aucun job laisserait la tete de file figee.
        await runScrapeUpdates(deferStatements);

        if (insertValues.length === 0) {
            console.log(`✅ Aucun nouveau job (${deferStatements.length} médias replanifiés).`);
            return { processed: 0 };
        }

        // 6. UN SEUL batch insert Supabase en premier (si ça fail, les next_scrape du lot
        // jobStatements ne sont pas touches → retry possible au prochain cycle)
        const { error: insertError } = await this.supabase
            .from('scraping_jobs')
            .insert(insertValues);
        if (insertError) {
            console.error("Erreur insertion jobs Supabase:", insertError);
            return { processed: 0 };
        }
        console.log(`📡 ${insertValues.length} scraping jobs queued`);

        // 7. UN SEUL batch D1 pour UPDATE les next_scrape
        await runScrapeUpdates(jobStatements);

        await logger.audit('Orchestrator', `Cycle terminé: ${insertValues.length} jobs créés sur ${staleMedia.length} médias analysés`, { processed: insertValues.length, deferred: deferStatements.length }, this.mongoUri);
        return { processed: insertValues.length };
    }
}
