import 'dotenv/config';
import postgres from 'postgres';

async function cleanup() {
    const supabaseUrl = process.env.SUPABASE_DATABASE_URL || '';
    if (!supabaseUrl) {
        console.log('SUPABASE_DATABASE_URL not set, skipping cleanup');
        process.exit(0);
    }

    const sql = postgres(supabaseUrl, { prepare: false });

    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const result = await sql`
        DELETE FROM scraping_jobs
        WHERE status = 'failed' AND updated_at < ${cutoff}
    `;

    console.log(`Cleaned up ${result.count || 0} failed jobs older than 7 days`);
    await sql.end();
    process.exit(0);
}

cleanup().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
});
