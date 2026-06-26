import 'dotenv/config';
import axios from 'axios';
import { getNeonClient } from '../db/singleton';
import { liens, medias } from '../db/neon/schema';
import { eq, sql, and, inArray } from 'drizzle-orm';

async function mapConcurrent<T, R>(
    items: T[],
    fn: (item: T) => Promise<R>,
    concurrency: number
): Promise<R[]> {
    const results: R[] = [];
    const pool = new Set<Promise<void>>();
    for (const item of items) {
        const promise = fn(item).then((result) => { results.push(result); });
        pool.add(promise);
        promise.then(() => pool.delete(promise));
        if (pool.size >= concurrency) await Promise.race(pool);
    }
    await Promise.all(pool);
    return results;
}

async function checkLinks() {
    console.log("🔍 Starting Dead Link Checker (Batch Mode)...");

    const neonUrl = process.env.NEON_DATABASE_URL || '';
    if (!neonUrl) throw new Error("NEON_DATABASE_URL is missing");

    const { db, client: pgClient } = getNeonClient(neonUrl);

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

    const aliveIds: string[] = [];
    const deadFailCounts: { id: string; failCount: number; shouldDeactivate: boolean; mediaId: string }[] = [];

    await mapConcurrent(linksToCheck, async (link) => {
        try {
            const response = await axios.head(link.url, { timeout: 5000, validateStatus: () => true });
            if (response.status >= 200 && response.status < 400) {
                aliveIds.push(link.id);
            } else {
                const newFailCount = (link.failCount || 0) + 1;
                deadFailCounts.push({
                    id: link.id,
                    failCount: newFailCount,
                    shouldDeactivate: newFailCount >= 3,
                    mediaId: link.mediaId
                });
            }
        } catch (error) {
            deadFailCounts.push({
                id: link.id,
                failCount: (link.failCount || 0) + 1,
                shouldDeactivate: (link.failCount || 0) + 1 >= 3,
                mediaId: link.mediaId
            });
        }
    }, 10);

    // Batch UPDATEs en 2-3 appels au lieu de 200
    if (aliveIds.length > 0) {
        await db.update(liens)
            .set({ lastVerified: new Date(), failCount: 0 })
            .where(inArray(liens.id, aliveIds));
    }

    const toDeactivate = deadFailCounts.filter(d => d.shouldDeactivate);
    const justIncrement = deadFailCounts.filter(d => !d.shouldDeactivate);

    if (justIncrement.length > 0) {
        await db.update(liens)
            .set({ failCount: sql`fail_count + 1`, lastVerified: new Date() })
            .where(inArray(liens.id, justIncrement.map(d => d.id)));
    }

    if (toDeactivate.length > 0) {
        await db.update(liens)
            .set({ failCount: sql`fail_count + 1`, isActive: false, lastVerified: new Date() })
            .where(inArray(liens.id, toDeactivate.map(d => d.id)));

        // Batch decrement activeLinksCount for affected medias
        const mediaIds = [...new Set(toDeactivate.map(d => d.mediaId))];
        if (mediaIds.length > 0) {
            for (const mediaId of mediaIds) {
                const count = toDeactivate.filter(d => d.mediaId === mediaId).length;
                await db.update(medias)
                    .set({ activeLinksCount: sql`active_links_count - ${count}` })
                    .where(eq(medias.id, mediaId));
            }
        }
    }

    console.log(`✅ Done: ${aliveIds.length} alive, ${justIncrement.length} incremented, ${toDeactivate.length} deactivated.`);
    await pgClient.end();
}

checkLinks().catch(console.error);
