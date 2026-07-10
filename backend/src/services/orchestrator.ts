import { getSupabaseHttpClient, getNeonDb } from "../db/singleton";
import { medias } from "../db/neon/schema";
import { inArray } from 'drizzle-orm';
import { logger } from "./logger";

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
            WHERE next_scrape < ? AND type != 'book'
            ORDER BY next_scrape ASC
            LIMIT 100
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

        // 2. UNE seule query Supabase : vérifie les jobs existants pour tous les media_ids
        const { data: existingJobs, error: jobsError } = await this.supabase
            .from('scraping_jobs')
            .select('media_id')
            .in('media_id', mediaIds)
            .in('status', ['pending', 'processing']);

        if (jobsError) {
            console.error("Erreur vérification jobs Supabase:", jobsError);
            return { processed: 0 };
        }

        const existingMediaIds = new Set((existingJobs || []).map((j: any) => j.media_id));

        // 3. Récupère title/slug : priorité D1 (stocké à l'ingest), fallback Neon avec retry
        const mediaInfoMap = new Map<string, { id: string; title: string; slug: string }>();

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
                        slug: medias.slug
                    })
                        .from(medias)
                        .where(inArray(medias.id, missingIds));
                    for (const m of mediaInfos as any[]) {
                        mediaInfoMap.set(m.id, { id: m.id, title: m.title, slug: m.slug });
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
        const updateStatements: any[] = [];
        const nextScrape = now + (6 * 3600000);

        for (const media of readyMedia) {
            const { media_id, type } = media;
            if (existingMediaIds.has(media_id)) continue;

            const mediaInfo = mediaInfoMap.get(media_id);
            if (!mediaInfo) continue;

            if (type === 'book') continue;

            const isStreaming = type === 'film' || type === 'serie' || type === 'anime';
            if (isStreaming) continue;

            const workerType =
                (type === 'game' || type === 'jeu') ? 'playwright' :
                type === 'novel' ? 'novel' :
                (type === 'webtoon' || type === 'comic' || type === 'manga') ? 'webtoon' :
                null;
            if (!workerType) continue;

            insertValues.push({
                media_id: media_id,
                media_type: type,
                worker_type: workerType,
                title: mediaInfo.title,
                slug: mediaInfo.slug,
                status: 'pending',
                priority: 1
            });

            updateStatements.push(
                this.db.prepare(`
                    UPDATE media_state SET next_scrape = ? WHERE media_id = ?
                `).bind(nextScrape, media_id)
            );
        }

        if (insertValues.length === 0) {
            console.log("✅ Tous les médias ont déjà des jobs en cours.");
            return { processed: 0 };
        }

        // 5. UN SEUL batch insert Supabase en premier (si ça fail, D1 n'est pas modifié → retry possible)
        const { error: insertError } = await this.supabase
            .from('scraping_jobs')
            .insert(insertValues);
        if (insertError) {
            console.error("Erreur insertion jobs Supabase:", insertError);
            return { processed: 0 };
        }
        console.log(`📡 ${insertValues.length} scraping jobs queued`);

        // 6. UN SEUL batch D1 pour UPDATE les next_scrape
        if (updateStatements.length > 0) {
            const BATCH_SIZE = 100;
            for (let i = 0; i < updateStatements.length; i += BATCH_SIZE) {
                await this.db.batch(updateStatements.slice(i, i + BATCH_SIZE));
            }
        }

        await logger.audit('Orchestrator', `Cycle terminé: ${insertValues.length} jobs créés sur ${staleMedia.length} médias analysés`, { processed: insertValues.length }, this.mongoUri);
        return { processed: insertValues.length };
    }
}
