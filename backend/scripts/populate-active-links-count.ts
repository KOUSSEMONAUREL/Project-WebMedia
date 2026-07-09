import "dotenv/config";
import { createClient } from "@libsql/client";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    console.error("TURSO_DATABASE_URL is required");
    process.exit(1);
  }

  const turso = createClient({ url, authToken: token });
  console.log(`Connected to ${url}`);

  const result = await turso.execute(`
    UPDATE medias
    SET active_links_count = (
      SELECT COUNT(*) FROM liens
      WHERE liens.media_id = medias.id AND liens.is_active = 1
    )
  `);
  console.log(`Updated ${result.rowsAffected} rows`);

  const sample = await turso.execute(`
    SELECT type, COUNT(*) as total,
      SUM(CASE WHEN active_links_count > 0 THEN 1 ELSE 0 END) as with_links
    FROM medias GROUP BY type ORDER BY type
  `);
  console.table(sample.rows);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
