import { listScrapers, ScraperInfo } from '../src/runner';

const TIMEOUT_MS = 10_000;

async function testScraper(info: ScraperInfo): Promise<{ status: string; count: number; error?: string }> {
  try {
    const mod = await import(info.filePath);
    const ScraperClass = mod[info.className] || mod.default;
    if (!ScraperClass) {
      return { status: 'ERR', count: 0, error: 'Class not found' };
    }
    const instance = new ScraperClass();
    if (typeof instance.getPopular !== 'function') {
      return { status: 'SKIP', count: 0, error: 'No getPopular' };
    }
    const promise = instance.getPopular(1);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), TIMEOUT_MS)
    );
    const result = await Promise.race([promise, timeoutPromise]);
    if (!result || !result.mangas) {
      return { status: 'ERR', count: 0, error: 'Bad response shape' };
    }
    const mangas = result.mangas;
    if (mangas.length === 0) {
      return { status: 'EMPTY', count: 0 };
    }
    return { status: 'OK', count: mangas.length };
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes('TIMEOUT')) {
      return { status: 'TIMEOUT', count: 0, error: msg };
    }
    const status = msg.includes('404') ? '404' :
                   msg.includes('DNS') || msg.includes('getaddrinfo') ? 'DNS' :
                   msg.includes('403') ? '403' :
                   msg.includes('5') && /5\d{2}/.test(msg) ? 'SRV_ERR' :
                   'ERR';
    return { status, count: 0, error: msg.slice(0, 120) };
  }
}

async function main() {
  const scrapers = listScrapers();
  const total = scrapers.length;
  console.log(`Total scrapers found: ${total}\n`);

  const results: Record<string, { info: ScraperInfo; status: string; count: number; error?: string }> = {};
  const CONCURRENCY = 20;
  let completed = 0;

  async function processBatch(batch: ScraperInfo[]) {
    const tasks = batch.map(async (info) => {
      const result = await testScraper(info);
      results[info.name] = { info, ...result };
      return { info, result };
    });
    const done = await Promise.all(tasks);
    for (const { info, result } of done) {
      completed++;
      console.log(`[${completed}/${total}] ${info.name.padEnd(30)} ${result.status.padEnd(8)} ${result.count ? `(${result.count})` : ''} ${result.error ? '— ' + result.error : ''}`);
    }
  }

  for (let i = 0; i < total; i += CONCURRENCY) {
    const batch = scrapers.slice(i, i + CONCURRENCY);
    await processBatch(batch);
  }

  const grouped: Record<string, { name: string; status: string; count: number }[]> = {};
  for (const [name, r] of Object.entries(results)) {
    (grouped[r.status] ||= []).push({ name, status: r.status, count: r.count });
  }

  console.log('\n' + '='.repeat(60));
  for (const [status, items] of Object.entries(grouped).sort()) {
    console.log(`\n${status} (${items.length}):`);
    if (status === 'EMPTY') {
      for (const item of items) console.log(`  ${item.name}`);
    } else if (status === 'OK') {
      console.log(`  ${items.length} scrapers OK`);
    } else {
      for (const item of items) {
        const r = results[item.name];
        console.log(`  ${item.name.padEnd(30)} ${r.error ? '— ' + r.error : ''}`);
      }
    }
  }
}

main().catch(console.error);
