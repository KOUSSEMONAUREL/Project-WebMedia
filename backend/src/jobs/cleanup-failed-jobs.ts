import 'dotenv/config';
import postgres from 'postgres';
import { createClient } from '@libsql/client';
import { getNeonClient } from '../db/singleton';
import { medias as neonMedias, episodes as neonEpisodes, liens as neonLiens } from '../db/neon/schema';
import { eq, inArray } from 'drizzle-orm';

async function cleanup() {
    const supabaseUrl = process.env.SUPABASE_DATABASE_URL || '';
    if (!supabaseUrl) throw new Error('SUPABASE_DATABASE_URL missing');

    const neonUrl = process.env.NEON_DATABASE_URL || '';
    const tursoUrl = process.env.TURSO_DATABASE_URL || '';
    const tursoToken = process.env.TURSO_AUTH_TOKEN || '';
    const apiUrl = process.env.INTERNAL_API_URL || '';
    const apiKey = process.env.INTERNAL_API_KEY || '';

    const cutoff = new Date(Date.now() - 3 * 24 * 3600 * 1000);

    // 1. Trouver les medias avec jobs failed > 1 jour
    const sb = postgres(supabaseUrl, { prepare: false });
    const failedMedia = await sb`
        SELECT DISTINCT media_id, media_type, title
        FROM scraping_jobs
        WHERE status = 'failed' AND updated_at < ${cutoff}
    `;
    console.log(`Found ${failedMedia.length} failed medias to clean`);

    // Toujours clean les success meme si aucun failed
    const alwaysCleanup = async () => {
        const successCutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
        const deletedSuccess = await sb`
            DELETE FROM scraping_jobs WHERE status = 'success' AND updated_at < ${successCutoff}
        `;
        console.log(`Supabase: ${deletedSuccess.count} old success scraping_jobs deleted`);
    };

    if (failedMedia.length === 0) {
        await alwaysCleanup();
        await sb.end();
        process.exit(0);
    }

    const allMediaIds = failedMedia.map((r: any) => r.media_id);
    const novelIds = failedMedia.filter((r: any) => r.media_type === 'novel').map((r: any) => r.media_id);
    const otherIds = failedMedia.filter((r: any) => r.media_type !== 'novel').map((r: any) => r.media_id);

    // 2. Supprimer de Supabase (scraping_jobs - failed)
    const deletedJobs = await sb`
        DELETE FROM scraping_jobs WHERE media_id IN ${sb(allMediaIds)}
    `;
    console.log(`Supabase: ${deletedJobs.count} failed scraping_jobs deleted`);

    // 3. Clean aussi les success vieux (Supabase seulement, audit trail)
    await alwaysCleanup();

    // 4. Supprimer de D1 (media_state) via API (tous les types)
    if (apiUrl && apiKey) {
        for (const id of allMediaIds) {
            try {
                await fetch(`${apiUrl}/api/internal/cleanup/d1-state`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': apiKey },
                    body: JSON.stringify({ mediaId: id })
                });
            } catch { /* ignore */ }
        }
        console.log(`D1: ${allMediaIds.length} media_state entries cleaned`);
    } else {
        console.log('D1: skipped (no API config)');
    }

    // 5. Supprimer de Neon — sauf les novels (ont deja des liens RoyalRoad)
    if (neonUrl && otherIds.length > 0) {
        const { db: neonDb, client: pgClient } = getNeonClient(neonUrl);
        const deletedNeon = await neonDb.delete(neonMedias)
            .where(inArray(neonMedias.id, otherIds));
        console.log(`Neon: ${deletedNeon.count || otherIds.length} medias + episodes/liens (cascade) deleted`);
        await pgClient.end();
    }
    if (novelIds.length > 0) {
        console.log(`Neon: SKIPPED ${novelIds.length} novels (existing links preserved)`);
    }

    // 6. Supprimer de Turso — sauf les novels
    if (tursoUrl && otherIds.length > 0) {
        const tc = createClient({ url: tursoUrl, authToken: tursoToken });
        for (const id of otherIds) {
            await tc.execute({ sql: 'DELETE FROM liens WHERE media_id = ?', args: [id] });
            await tc.execute({ sql: 'DELETE FROM episodes WHERE media_id = ?', args: [id] });
            await tc.execute({ sql: 'DELETE FROM medias WHERE id = ?', args: [id] });
        }
        console.log(`Turso: ${otherIds.length} medias + episodes + liens deleted`);
        if (novelIds.length > 0) {
            console.log(`Turso: SKIPPED ${novelIds.length} novels (existing links preserved)`);
        }
        tc.close();
    } else if (novelIds.length > 0) {
        console.log(`Turso: SKIPPED ${novelIds.length} novels (existing links preserved)`);
    }

    await sb.end();
    console.log('Cleanup done.');
    process.exit(0);
}

cleanup().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
});
