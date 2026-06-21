import 'dotenv/config';
import axios from 'axios';
import { createNeonClient } from '../db/client';
import { liens, medias } from '../db/neon/schema';
import { eq, lt, sql, and } from 'drizzle-orm';

// Utilitaire simple pour limiter la concurrence
async function mapConcurrent<T, R>(
    items: T[],
    fn: (item: T) => Promise<R>,
    concurrency: number
): Promise<R[]> {
    const results: R[] = [];
    const pool = new Set<Promise<void>>();

    for (const item of items) {
        const promise = fn(item).then((result) => {
            results.push(result);
        });
        pool.add(promise);
        promise.then(() => pool.delete(promise));

        if (pool.size >= concurrency) {
            await Promise.race(pool);
        }
    }
    await Promise.all(pool);
    return results;
}

async function checkLinks() {
    console.log("🔍 Starting Dead Link Checker...");

    const neonUrl = process.env.NEON_DATABASE_URL || '';
    if (!neonUrl) throw new Error("NEON_DATABASE_URL is missing");

    const { db, client: pgClient } = createNeonClient(neonUrl);

    // 1. Récupérer les liens
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const linksToCheck = await db.select()
        .from(liens)
        .where(
            and(
                eq(liens.isActive, true),
                sql`${liens.lastVerified} < ${sevenDaysAgo.toISOString()} OR ${liens.lastVerified} IS NULL`
            )
        )
        .limit(100);

    console.log(`📡 Checking ${linksToCheck.length} links (concurrently)...`);

    await mapConcurrent(linksToCheck, async (link) => {
        try {
            const response = await axios.head(link.url, { timeout: 5000, validateStatus: () => true });

            const isAlive = response.status >= 200 && response.status < 400;

            if (isAlive) {
                await db.update(liens)
                    .set({ lastVerified: new Date(), failCount: 0 })
                    .where(eq(liens.id, link.id));
            } else {
                const newFailCount = (link.failCount || 0) + 1;
                const shouldDeactivate = newFailCount >= 3;

                await db.update(liens)
                    .set({
                        failCount: newFailCount,
                        isActive: !shouldDeactivate,
                        lastVerified: new Date()
                    })
                    .where(eq(liens.id, link.id));

                if (shouldDeactivate) {
                    console.log(`❌ Deactivating dead link: ${link.url}`);
                    await db.update(medias)
                        .set({ activeLinksCount: sql`active_links_count - 1` })
                        .where(eq(medias.id, link.mediaId));
                }
            }
        } catch (error) {
            console.error(`Error checking ${link.url}:`, (error as Error).message);
        }
    }, 10); // Concurrence de 10

    // Fermer proprement la connexion postgres
    await pgClient.end();
    console.log("✅ Dead Link Checker finished.");
}

checkLinks().catch(console.error);
