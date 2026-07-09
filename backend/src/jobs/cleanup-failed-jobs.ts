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

    const cutoff = new Date(Date.now() - 24 * 3600 * 1000);

    // 1. Trouver les medias avec jobs failed > 1 jour
    const sb = postgres(supabaseUrl, { prepare: false });
    const failedMedia = await sb`
        SELECT DISTINCT media_id, media_type, title
        FROM scraping_jobs
        WHERE status = 'failed' AND updated_at < ${cutoff}
    `;
    console.log(`Found ${failedMedia.length} failed medias to clean`);

    if (failedMedia.length === 0) {
        await sb.end();
        process.exit(0);
    }

    const mediaIds = failedMedia.map((r: any) => r.media_id);

    // 2. Supprimer de Supabase (scraping_jobs)
    const deletedJobs = await sb`
        DELETE FROM scraping_jobs WHERE media_id IN ${sb(mediaIds)}
    `;
    console.log(`Supabase: ${deletedJobs.count} scraping_jobs deleted`);

    // 3. Supprimer de D1 (media_state) via API
    if (apiUrl && apiKey) {
        for (const id of mediaIds) {
            try {
                await fetch(`${apiUrl}/api/internal/cleanup/d1-state`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': apiKey },
                    body: JSON.stringify({ mediaId: id })
                });
            } catch { /* ignore */ }
        }
        console.log(`D1: ${mediaIds.length} media_state entries cleaned`);
    } else {
        console.log('D1: skipped (no API config)');
    }

    // 4. Supprimer de Neon (medias + episodes + liens via cascade)
    if (neonUrl) {
        const { db: neonDb, client: pgClient } = getNeonClient(neonUrl);
        const deletedNeon = await neonDb.delete(neonMedias)
            .where(inArray(neonMedias.id, mediaIds));
        console.log(`Neon: ${deletedNeon.count || mediaIds.length} medias + episodes/liens (cascade) deleted`);
        await pgClient.end();
    }

    // 5. Supprimer de Turso
    if (tursoUrl) {
        const tc = createClient({ url: tursoUrl, authToken: tursoToken });
        for (const id of mediaIds) {
            await tc.execute({ sql: 'DELETE FROM liens WHERE media_id = ?', args: [id] });
            await tc.execute({ sql: 'DELETE FROM episodes WHERE media_id = ?', args: [id] });
            await tc.execute({ sql: 'DELETE FROM medias WHERE id = ?', args: [id] });
        }
        console.log(`Turso: ${mediaIds.length} medias + episodes + liens deleted`);
        tc.close();
    }

    await sb.end();
    console.log('Cleanup done.');
    process.exit(0);
}

cleanup().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
});
