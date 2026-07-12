async function main() {
  const databaseUrl = process.env.NEON_DATABASE_URL!;
  const tursoUrl = process.env.TURSO_DATABASE_URL!;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;
  if (!databaseUrl || !tursoUrl) { console.error('Missing env'); process.exit(1); }
  console.log('Starting sync...');
  const { syncNeonToTurso } = await import('./sync-turso.js');
  await syncNeonToTurso(databaseUrl, tursoUrl, tursoToken as string);
  console.log('Done');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
