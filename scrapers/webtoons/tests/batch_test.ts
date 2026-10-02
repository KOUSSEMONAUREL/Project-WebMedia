import { listScrapers, ScraperInfo } from '../src/runner';
import { describeProbe, probeOrigin } from './origin_diagnose';

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
      // Zéro résultat : la seule question utile est « le site existe encore ? ».
      // La sonde sépare le port cassé du site mort, donc plus besoin de
      // re-diagnostiquer chaque site vide à la main.
      const probe = await probeOrigin(instance.baseUrl);
      // `EMPTY_DEAD` : le site a disparu, le port ne peut plus rien produire et
      // doit partir au registre. `EMPTY` : le site répond, le sélecteur ne
      // matche plus et le port est à corriger. Confondre les deux fait soit
      // garder un fichier mort, soit effacer un port récupérable.
      const status = probe.verdict === 'DEAD' ? 'EMPTY_DEAD' : 'EMPTY';
      return { status, count: 0, error: describeProbe(probe) };
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
  // Filtre optionnel : `tsx tests/batch_test.ts manga comics` pour rejouer
  // uniquement les scrapers qui matchent. Sans lui, on re-teste les 60+ à chaque
  // fois qu'on cherche à comprendre un seul port vide.
  const filters = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const all = listScrapers();
  const scrapers = filters.length
    ? all.filter((s) => filters.some((f) => s.name.includes(f) || s.filePath.includes(f)))
    : all;
  const total = scrapers.length;
  console.log(`Total scrapers found: ${total}${filters.length ? ` (filtre: ${filters.join(', ')})` : ''}\n`);

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
    if (status === 'OK') {
      console.log(`  ${items.length} scrapers OK`);
      continue;
    }
    for (const item of items) {
      const r = results[item.name];
      const count = r.count ? ` (${r.count})` : '';
      console.log(`  ${item.name.padEnd(30)}${count} — ${r.error ?? ''}`);
    }
  }

  // Récap : les ports vides ne sont plus interchangeables. « site mort » et
  // « site bloqué » se corrigent dans SOURCES_NON_SCRAPPABLES.md ; « port à
  // corriger » est le seul cas qui demande du travail de parsing.
  const empties = Object.values(results)
    .filter((r) => r.status === 'EMPTY' || r.status === 'EMPTY_DEAD');
  // Le statut `EMPTY_DEAD` est authoritaire ; le préfixe du message sert de
  // filet pour les verdicts non-DEAD (UNKNOWN resteUNKNOWN, pas mort).
  const dead = empties.filter((r) => r.status === 'EMPTY_DEAD');
  const blocked = empties.filter((r) => r.error?.startsWith('site bloqué'));
  const broken = empties.filter((r) => r.status === 'EMPTY' &&
    r.error?.startsWith('site vivant'));
  if (empties.length) {
    console.log(`\nDiagnostic EMPTY (${empties.length}):`);
    console.log(`  ${dead.length} site mort (port inutile)    : ${dead.map((r) => r.info.name).join(', ') || '-'}`);
    console.log(`  ${blocked.length} site bloqué (port inutile): ${blocked.map((r) => r.info.name).join(', ') || '-'}`);
    console.log(`  ${broken.length} port à corriger           : ${broken.map((r) => r.info.name).join(', ') || '-'}`);
    console.log('  Cf scrapers/webtoons/SOURCES_NON_SCRAPPABLES.md pour les sites morts/bloqués.');
  }
}

main().catch(console.error);
