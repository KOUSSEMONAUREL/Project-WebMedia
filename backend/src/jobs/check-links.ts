import 'dotenv/config';
import axios from 'axios';
import { getNeonClient, getTursoClient } from '../db/singleton';
import { liens, medias, episodes } from '../db/neon/schema';
import { medias as tursoMedias, episodes as tursoEpisodes, liens as tursoLiens } from '../db/turso/schema';
import { eq, sql, and, inArray } from 'drizzle-orm';

async function mapConcurrent<T, R>(
    items: T[],
    fn: (item: T) => Promise<R>,
    concurrency: number
): Promise<R[]> {
    const results: R[] = [];
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        const batchResults = await Promise.all(batch.map(fn));
        results.push(...batchResults);
    }
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

    // Sync Neon -> Turso pour que le cache edge reflète les changements
    const tursoUrl = process.env.TURSO_DATABASE_URL || '';
    const tursoToken = process.env.TURSO_AUTH_TOKEN || '';
    if (tursoUrl && tursoToken) {
        console.log('🔄 Syncing Neon -> Turso...');
        await syncNeonToTurso(neonUrl, tursoUrl, tursoToken);
    }

    await pgClient.end();
}

async function syncNeonToTurso(neonUrl: string, tursoUrl: string, tursoToken: string) {
    const { db: neonDb } = getNeonClient(neonUrl);
    const tursoDb = getTursoClient(tursoUrl, tursoToken);
    const CONCURRENT = 10;

    async function upsertBatch(table: any, rows: any[], label: string, transform: (r: any) => any) {
        if (rows.length === 0) return;
        let done = 0;
        for (let i = 0; i < rows.length; i += CONCURRENT) {
            const chunk = rows.slice(i, i + CONCURRENT);
            await Promise.all(chunk.map(async (row) => {
                const vals = transform(row);
                const { id, ...rest } = vals;
                await tursoDb.insert(table).values(vals)
                    .onConflictDoUpdate({ target: table.id, set: { ...rest } });
            }));
            done += chunk.length;
            if (done % 100 === 0 || done === rows.length) {
                console.log(`  ${label}: ${done}/${rows.length}`);
            }
        }
    }

    console.log('Sync medias...');
    const allMedias = await neonDb.select().from(medias);
    await upsertBatch(tursoMedias, allMedias, 'medias', (m: any) => ({
        ...m,
        slug: m.slug?.slice(0, 100),
        rating: m.rating?.toString(),
        metadataFreshAt: m.metadataFreshAt ? new Date(m.metadataFreshAt) : null,
        linksLastScrapedAt: m.linksLastScrapedAt ? new Date(m.linksLastScrapedAt) : null,
        createdAt: new Date(m.createdAt!),
        updatedAt: new Date(m.updatedAt!)
    }));

    console.log('Sync episodes...');
    const allEpisodes = await neonDb.select().from(episodes);
    await upsertBatch(tursoEpisodes, allEpisodes, 'episodes', (e: any) => ({
        ...e,
        airDate: e.airDate ? new Date(e.airDate) : null
    }));

    console.log('Sync liens...');
    const allLiens = await neonDb.select().from(liens);
    await upsertBatch(tursoLiens, allLiens, 'liens', (l: any) => ({
        ...l,
        lastVerified: l.lastVerified ? new Date(l.lastVerified) : null,
        scrapedAt: l.scrapedAt ? new Date(l.scrapedAt) : null
    }));

    console.log(`✅ Sync Turso termine: ${allMedias.length} medias, ${allEpisodes.length} episodes, ${allLiens.length} links.`);
}

checkLinks().catch(console.error);
