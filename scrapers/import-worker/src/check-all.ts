import postgres from 'postgres';

const supabaseClient = postgres(process.env.SUPABASE_DATABASE_URL || '', { prepare: false });

async function main() {
  const jobsByType = await supabaseClient`
    SELECT worker_type, status, COUNT(*) as count
    FROM scraping_jobs
    GROUP BY worker_type, status
    ORDER BY worker_type, status
  `;
  console.log('=== Scraping Jobs in Supabase ===');
  for (const r of jobsByType) {
    console.log(`${r.worker_type} | ${r.status}: ${r.count}`);
  }

  // Check if any webtoon/comic/game media are in media_state
  const mediaState = await supabaseClient`
    SELECT type, COUNT(*) as count
    FROM media_state
    WHERE type IN ('webtoon', 'comic', 'game', 'novel')
    GROUP BY type
    ORDER BY type
  `;
  console.log('\n=== Media State in D1 ===');
  for (const r of mediaState) {
    console.log(`${r.type}: ${r.count}`);
  }

  // Check pending jobs that are stale
  const stalePending = await supabaseClient`
    SELECT worker_type, COUNT(*) as count
    FROM scraping_jobs
    WHERE status = 'pending'
      AND created_at < NOW() - INTERVAL '1 day'
    GROUP BY worker_type
  `;
  console.log('\n=== Stale Pending Jobs (>1 day old) ===');
  for (const r of stalePending) {
    console.log(`${r.worker_type}: ${r.count}`);
  }
}
main().catch(console.error);
