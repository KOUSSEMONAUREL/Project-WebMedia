import 'dotenv/config';
import { createClient } from '@libsql/client';

const MAX_SLUG_LEN = 100;
const turso = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function main() {
  const rows = await turso.execute(
    `SELECT id, slug, title FROM medias WHERE length(slug) > ${MAX_SLUG_LEN}`
  );

  if (rows.rows.length === 0) {
    console.log('Aucun slug long trouve.');
    return;
  }

  console.log(`${rows.rows.length} slug(s) long(s) trouves.`);

  const used = new Set<string>();

  for (const row of rows.rows) {
    let newSlug = (row.slug as string).slice(0, MAX_SLUG_LEN).replace(/-+$/, '');
    while (used.has(newSlug)) {
      newSlug = newSlug.slice(0, MAX_SLUG_LEN - 3) + '-' + Math.random().toString(36).slice(2, 5);
    }
    used.add(newSlug);
    // Check uniqueness in DB
    const existing = await turso.execute(
      `SELECT id FROM medias WHERE slug = ? AND id != ?`,
      [newSlug, row.id as string]
    );
    if (existing.rows.length > 0) {
      newSlug = newSlug.slice(0, MAX_SLUG_LEN - 5) + '-' + Math.random().toString(36).slice(2, 6);
    }
    await turso.execute(
      `UPDATE medias SET slug = ? WHERE id = ?`,
      [newSlug, row.id as string]
    );
    console.log(`  ${(row.slug as string).slice(0, 60)}... -> ${newSlug}`);
  }

  console.log('Patch termine.');
}

main().catch(console.error).finally(() => turso.close());
