import { createNeonClient, createTursoClient } from './db/client.js';
import { medias, episodes, liens } from './db/neon/schema.js';
import { medias as tursoMedias, episodes as tursoEpisodes, liens as tursoLiens } from './db/turso/schema.js';
import { sql } from 'drizzle-orm';

export async function syncNeonToTurso(neonUrl: string, tursoUrl: string, tursoToken: string) {
    const neon = createNeonClient(neonUrl);
    const turso = createTursoClient(tursoUrl, tursoToken);

    console.log('🔄 Syncing Neon -> Turso...');

    try {
        // 1. Sync Medias
        const allMedias = await neon.select().from(medias);
        if (allMedias.length > 0) {
            // Bulk upsert logic for SQLite (Turso)
            for (const m of allMedias) {
                await turso.insert(tursoMedias).values({
                    ...m,
                    rating: m.rating?.toString(),
                    metadataFreshAt: m.metadataFreshAt ? new Date(m.metadataFreshAt) : null,
                    linksLastScrapedAt: m.linksLastScrapedAt ? new Date(m.linksLastScrapedAt) : null,
                    createdAt: new Date(m.createdAt!),
                    updatedAt: new Date(m.updatedAt!)
                }).onConflictDoUpdate({
                    target: tursoMedias.id,
                    set: { ...m, rating: m.rating?.toString(), updatedAt: new Date() }
                });
            }
        }

        // 2. Sync Episodes
        const allEpisodes = await neon.select().from(episodes);
        if (allEpisodes.length > 0) {
            for (const e of allEpisodes) {
                await turso.insert(tursoEpisodes).values({
                    ...e,
                    airDate: e.airDate ? new Date(e.airDate) : null
                }).onConflictDoUpdate({
                    target: tursoEpisodes.id,
                    set: { ...e }
                });
            }
        }

        // 3. Sync Liens (Scraped content)
        const allLiens = await neon.select().from(liens);
        if (allLiens.length > 0) {
            for (const l of allLiens) {
                await turso.insert(tursoLiens).values({
                    ...l,
                    lastVerified: l.lastVerified ? new Date(l.lastVerified) : null,
                    scrapedAt: l.scrapedAt ? new Date(l.scrapedAt) : null
                }).onConflictDoUpdate({
                    target: tursoLiens.id,
                    set: { ...l }
                });
            }
        }

        console.log(`✅ Sync finished: ${allMedias.length} medias, ${allEpisodes.length} episodes, ${allLiens.length} links.`);
    } catch (error: any) {
        console.error('❌ Sync Error:', error.message);
    }
}
