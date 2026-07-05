import { medias } from '../db/neon/schema.js';
import { inArray } from 'drizzle-orm';

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
  internalApiKey: string,
  title?: string,
  slug?: string,
): Promise<void> {
  if (!internalApiUrl || !internalApiKey) return;
  try {
    const { default: axios } = await import('axios');
    await axios.post(`${internalApiUrl}/ingest/media`, {
      id: mediaId,
      type: mediaType,
      metadata_ok: 1,
      title,
      slug,
    }, {
      headers: { 'X-Internal-API-Key': internalApiKey },
      timeout: 5000,
    });
  } catch (err: any) {
    console.error(`notifyBrain error (${mediaId}): ${err?.message || err}`);
  }
}

export async function notifyBrainBatch(
  items: { id: string; type: string; title?: string; slug?: string }[],
  internalApiUrl: string,
  internalApiKey: string
): Promise<void> {
  if (!internalApiUrl || !internalApiKey || items.length === 0) return;
  try {
    const { default: axios } = await import('axios');
    await axios.post(`${internalApiUrl}/ingest/media/batch`, {
      items: items.map(i => ({ id: i.id, type: i.type, metadata_ok: 1, title: i.title, slug: i.slug }))
    }, {
      headers: { 'X-Internal-API-Key': internalApiKey },
      timeout: 30000,
    });
  } catch (err: any) {
    console.error(`notifyBrainBatch error (${items.length} items): ${err.message}`);
  }
}

export async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.response?.status;
      const isServerError = status >= 500 && status < 600;
      const isNetworkError = !err?.response && ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'].includes(err?.code);
      if (i === retries - 1 || (!isServerError && !isNetworkError)) throw err;
      const delay = 1000 * Math.pow(2, i);
      console.log(`⚠️ Retry ${i + 1}/${retries - 1} dans ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}
