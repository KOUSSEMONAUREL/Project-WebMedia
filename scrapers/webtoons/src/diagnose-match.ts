
import { findMatchingScrapers } from './pipeline';
// Titres reales : deuxKnown-good, trois traites comme introuvables par le run CI.
const TITRES = ['Berserk','One Punch-Man','Golden Kamuy Character Remix','Hoshi to Michikusa','Angel Mate','Re:Zero','Kaguya-sama','Chainsaw Man'];
(async () => {
  console.log('Scrapers: '+(await import('./runner')).listScrapers().length);
  const lignes: string[] = [];
  for (const t of TITRES) {
    const t0 = Date.now();
    const m = await findMatchingScrapers({ id:'x', title:t, slug:'x', type:'webtoon' } as any);
    const s = `${t} => ${m.length} match(s) en ${((Date.now()-t0)/1000).toFixed(0)}s`;
    console.log('  ' + s);
    if (m.length) console.log('      sources: ' + m.slice(0,5).map((x: { name: string }) => x.name).join(', '));
    lignes.push(`| ${t} | ${m.length} | ${m.slice(0,3).map((x: { name: string }) => x.name).join(', ') || '—'} |`);
  }
  const sum = ['## Matching webtoons sur runner GitHub','',
    '| Titre | Matchs | Sources |','|---|---|---|',...lignes].join('\n');
  const fs = await import('fs');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, sum+'\n');
  console.log('\n'+sum);
  process.exit(0);
})();
