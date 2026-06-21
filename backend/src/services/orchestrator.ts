import { createDbClient } from "../db/client";
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
        this.supabase = createDbClient(env.SUPABASE_DATABASE_URL, 'supabase', env);
        this.neon = createDbClient(env.NEON_DATABASE_URL, 'neon', env);
        this.kv = env.KV;
        this.mongoUri = env.MONGODB_URI || process.env.MONGODB_URI;
    }

    async resolveStaleMedia() {
        // 0. Vérification KV pour éviter les doubles exécutions trop rapprochées
        if (this.kv) {
            const lastRun = await this.kv.get('orchestrator_last_run');
            if (lastRun && Date.now() - parseInt(lastRun) < 30 * 60 * 1000) {
                console.log("⏳ Orchestration sautée (trop tôt depuis le dernier run).");
                return { processed: 0, skipped: true };
            }
            await this.kv.put('orchestrator_last_run', Date.now().toString());
        }

        console.log("🚀 Starting Global Orchestration Cycle (Supabase Queue Mode)...");
        await logger.info('Orchestrator', 'Démarrage du cycle d\'orchestration', {}, this.mongoUri);
        const now = Date.now();

        // 1. On récupère les médias à rafraîchir depuis D1_STATE (LIMIT 50)
        const { results: staleMedia } = await this.db.prepare(`
            SELECT media_id, type, metadata_ok 
            FROM media_state 
            WHERE next_scrape < ? 
            ORDER BY next_scrape ASC
            LIMIT 50
        `).bind(now).all();

        for (const media of staleMedia as any[]) {
            const { media_id, type, metadata_ok } = media;

            try {
                // Si les métadonnées ne sont pas OK, on ignore (l'import-worker s'en occupera via ses crons TMDB)
                if (!metadata_ok) {
                    console.log(`⏳ Skipping ${media_id}: Metadata not ready yet.`);
                    continue;
                }

                // Déterminer le worker de scraping approprié
                const workerType = 
                    (type === 'game' || type === 'jeu') ? 'playwright' :
                    type === 'novel' ? 'novel' :
                    'cheerio';

                // 2. Vérifier si un job identique existe déjà
                const existing = await this.supabase.select()
                    .from(scrapingJobs)
                    .where(and(
                        eq(scrapingJobs.mediaId, media_id),
                        eq(scrapingJobs.workerType, workerType),
                        inArray(scrapingJobs.status, ['pending', 'processing'])
                    ))
                    .limit(1);

                if (existing.length === 0) {
                    // 3. Récupérer le titre et le slug depuis Neon
                    const mediaInfo = await this.neon.select({
                        title: medias.title,
                        slug: medias.slug
                    })
                        .from(medias)
                        .where(eq(medias.id, media_id))
                        .limit(1);

                    if (mediaInfo.length > 0) {
                        // 4. Insérer le job dans Supabase
                        await this.supabase.insert(scrapingJobs).values({
                            mediaId: media_id,
                            mediaType: type,
                            workerType: workerType,
                            title: mediaInfo[0].title,
                            slug: mediaInfo[0].slug,
                            status: 'pending',
                            priority: 1
                        });
                        console.log(`📡 Scraping job queued [${workerType}]: ${mediaInfo[0].title}`);
                    }
                }

                // 5. Update D1 (Prochain check dans 6h)
                await this.db.prepare(`
                    UPDATE media_state SET next_scrape = ? WHERE media_id = ?
                `).bind(now + (6 * 3600000), media_id).run();

            } catch (err: any) {
                console.error(`❌ Orchestration Error [${media_id}]:`, err.message);
            }
        }

        await logger.audit('Orchestrator', `Cycle terminé: ${staleMedia.length} médias analysés`, { processed: staleMedia.length }, this.mongoUri);
        return { processed: staleMedia.length };
    }
}
