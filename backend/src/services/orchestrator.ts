import { getSupabaseClient, getNeonDb } from "../db/singleton";
import { scrapingJobs } from "../db/supabase/schema";
import { medias } from "../db/neon/schema";
import { eq, and, inArray } from 'drizzle-orm';
import { logger } from "./logger";

export class OrchestratorService {
    private db: D1Database;
    private supabase: any;
    private neon: any;
    private kv: any;
    private mongoUri?: string;

    constructor(env: any) {
        this.db = env.DB;
        this.supabase = getSupabaseClient(env.SUPABASE_DATABASE_URL);
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
            SELECT media_id, type, metadata_ok
            FROM media_state
            WHERE next_scrape < ?
            ORDER BY next_scrape ASC
            LIMIT 100
        `).bind(now).all<{ media_id: string; type: string; metadata_ok: number }>();

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
        let existingJobs: any[];
        try {
            existingJobs = await this.supabase.select({ mediaId: scrapingJobs.mediaId })
                .from(scrapingJobs)
                .where(and(
                    inArray(scrapingJobs.mediaId, mediaIds),
                    inArray(scrapingJobs.status, ['pending', 'processing'])
                ));
        } catch (e) {
            console.error("❌ Supabase query failed, mediaIds count:", mediaIds.length);
            console.error(JSON.stringify(e, Object.getOwnPropertyNames(e), 2));
            throw e;
        }

        const existingMediaIds = new Set(existingJobs.map((j: any) => j.mediaId));

        // 3. UNE seule query Neon : récupère les infos de tous les médias
        let mediaInfos: any[];
        try {
            mediaInfos = await this.neon.select({
                id: medias.id,
                title: medias.title,
                slug: medias.slug
            })
                .from(medias)
                .where(inArray(medias.id, mediaIds));
        } catch (e) {
            console.error("❌ Neon query failed, mediaIds count:", mediaIds.length);
            console.error(JSON.stringify(e, Object.getOwnPropertyNames(e), 2));
            throw e;
        }

        const mediaInfoMap = new Map<string, { id: string; title: string; slug: string }>(mediaInfos.map((m: any) => [m.id, m]));

        // 4. Construire les batchs pour les inserts + updates
        const insertValues: any[] = [];
        const updateStatements: any[] = [];
        const nextScrape = now + (6 * 3600000);

        for (const media of readyMedia) {
            const { media_id, type } = media;
            if (existingMediaIds.has(media_id)) continue;

            const mediaInfo = mediaInfoMap.get(media_id);
            if (!mediaInfo) continue;

            const workerType =
                (type === 'game' || type === 'jeu') ? 'playwright' :
                type === 'novel' ? 'novel' :
                'cheerio';

            insertValues.push({
                mediaId: media_id,
                mediaType: type,
                workerType: workerType,
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

        // 5. UN SEUL batch insert Supabase
        await this.supabase.insert(scrapingJobs).values(insertValues);
        console.log(`📡 ${insertValues.length} scraping jobs queued`);

        // 6. UN SEUL batch D1 pour toutes les UPDATEs
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
