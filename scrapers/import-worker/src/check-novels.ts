import { neon } from '@neondatabase/serverless';

const sql = neon("postgresql://neondb_owner:npg_E6aQTN3DSyfJ@ep-round-bird-aokg2v7e.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require");

async function main() {
  for (const type of ['novel', 'webtoon', 'comic']) {
    const rows = await sql`
      SELECT type, COUNT(*) as total,
        COALESCE(SUM(active_links_count), 0) as sum_active,
        COUNT(*) FILTER (WHERE active_links_count > 0) as with_active
      FROM medias WHERE type = ${type} GROUP BY type
    `;
    console.log(`\n=== ${type} ===`);
    console.log(JSON.stringify(rows, null, 2));

    // medias with activeLinksCount > 0
    const withLinks = await sql`
      SELECT id, title, active_links_count FROM medias
      WHERE type = ${type} AND active_links_count > 0 LIMIT 5
    `;
    console.log('With activeLinksCount > 0:', JSON.stringify(withLinks, null, 2));

    // sample dead ones
    const dead = await sql`
      SELECT m.id, m.title, m.active_links_count,
        (SELECT COUNT(*) FROM liens WHERE media_id = m.id AND is_active = TRUE) as active_l,
        (SELECT COUNT(*) FROM liens WHERE media_id = m.id AND is_active = FALSE) as inactive_l,
        (SELECT COUNT(*) FROM liens WHERE media_id = m.id) as total_l
      FROM medias m WHERE m.type = ${type} AND m.active_links_count = 0
      LIMIT 5
    `;
    console.log('With activeLinksCount = 0:', JSON.stringify(dead, null, 2));
  }
}
main().catch(console.error);
