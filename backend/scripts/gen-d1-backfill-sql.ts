import postgres from 'postgres';

const sql = postgres(process.env.NEON_DATABASE_URL!, { max: 1, timeout: 15 });
const medias = await sql`SELECT id, title, slug FROM medias`;
await sql.end();

for (const m of medias) {
  const t = m.title?.replace(/'/g, "''") ?? '';
  const s = m.slug?.replace(/'/g, "''") ?? '';
  console.log(`UPDATE media_state SET title='${t}', slug='${s}' WHERE media_id='${m.id}';`);
}
