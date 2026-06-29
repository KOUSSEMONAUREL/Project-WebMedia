import fs from 'fs';
import { createNeonClient } from '../db/client.js';
import { importOffsets } from '../db/neon/schema.js';
import { eq } from 'drizzle-orm';

const OFFSET_FILE = '/tmp/import_offsets.json';

interface OffsetStore {
  [key: string]: number;
}

function readCache(): OffsetStore {
  try {
    return JSON.parse(fs.readFileSync(OFFSET_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeCache(data: OffsetStore): void {
  try {
    fs.writeFileSync(OFFSET_FILE, JSON.stringify(data));
  } catch {}
}

export async function getOffset(key: string, databaseUrl?: string, defaultVal = 0, db?: any): Promise<number> {
  // 1. Cache file (le plus rapide)
  const cache = readCache();
  if (key in cache) return cache[key];

  // 2. Fallback Neon
  const neonDb = db || (databaseUrl ? createNeonClient(databaseUrl) : null);
  if (neonDb) {
    try {
      const row = await neonDb.select({ value: importOffsets.value })
        .from(importOffsets)
        .where(eq(importOffsets.key, key))
        .limit(1);
      if (row[0]) {
        writeCache({ ...cache, [key]: row[0].value });
        return row[0].value;
      }
    } catch (err: any) {
      console.error(`⚠️ getOffset(${key}): ${err.message}`);
    }
  }

  // 3. Default
  return defaultVal;
}

export async function setOffset(key: string, value: number, databaseUrl?: string, db?: any): Promise<void> {
  // 1. Écrire cache file
  const cache = readCache();
  cache[key] = value;
  writeCache(cache);

  // 2. Upsert Neon
  const neonDb = db || (databaseUrl ? createNeonClient(databaseUrl) : null);
  if (neonDb) {
    try {
      await neonDb.insert(importOffsets).values({ key, value })
        .onConflictDoUpdate({ target: importOffsets.key, set: { value, updatedAt: new Date() } });
      console.log(`  📝 offset ${key} = ${value}`);
    } catch (err: any) {
      console.error(`⚠️ setOffset(${key}=${value}): ${err.message}`);
    }
  }
}
