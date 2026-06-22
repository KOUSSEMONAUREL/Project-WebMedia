import { createDbClient } from '../db/client.js';
import { medias } from '../db/neon/schema.js';
import { inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

export async function batchCheckExisting(
  db: any,
  field: any,
  values: (string | number)[]
): Promise<Set<string | number>> {
  if (values.length === 0) return new Set();
  const rows = await db.select({ val: field })
    .from(medias)
    .where(inArray(field, values));
  return new Set(rows.map((r: any) => r.val));
}

export async function notifyBrain(
  mediaId: string,
  mediaType: string,
  internalApiUrl: string,
  internalApiKey: string
): Promise<void> {
  if (!internalApiUrl || !internalApiKey) return;
  try {
    const { default: axios } = await import('axios');
    await axios.post(`${internalApiUrl}/ingest/media`, {
      id: mediaId,
      type: mediaType,
      metadata_ok: 1,
    }, {
      headers: { 'X-Internal-API-Key': internalApiKey },
      timeout: 5000,
    });
  } catch {}
}
