import { readFileSync } from 'fs';
import { resolve } from 'path';
import postgres from 'postgres';

const envPath = resolve(process.cwd(), '../../backend/.env');
const envContent = readFileSync(envPath, 'utf-8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
  process.env[key] = val;
}

const dbUrl = (process.env.NEON_DATABASE_URL || '').trim();
const sql = postgres(dbUrl);
const result = await sql`DELETE FROM import_offsets WHERE key IN ('tmdb:movie/popular', 'tmdb:tv/popular')`;
console.log(`Deleted ${result.count} old orphaned rows`);
await sql.end();
