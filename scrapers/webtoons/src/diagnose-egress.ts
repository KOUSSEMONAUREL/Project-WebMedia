/**
 * Diagnostic d'egress — aucune base de donnees, aucune mutation.
 *
 * But : isoler si l'echec de masse du Webtoon Scraper vient de l'IP de sortie
 * (runner GitHub derriere WARP) ou des sources elles-memes. Le meme runner
 * execute la sonde deux fois, WARP actif puis coupe : la seule variable est
 * l'IP, donc tout ecart entre les deux colonnes est attribuable au tunnel.
 *
 * Ne lit aucun secret, ne parle a aucune DB : uniquement des GET sortants.
 */

import { listScrapers, getScraper } from './runner';

const TITLES = ['Berserk', 'Chainsaw Man', 'One Punch-Man'];

// Echantillon raisonne : des sources qui repondent en local, des sources qui ont
// renvoye 403/522 dans le run CI, et une source sans getSearch().
const SAMPLE = [
  'MangaKatana',
  'MangaFire',
  'MangaRead',
  'ToonHey',
  'Temple Scan',
  'Asmodeus Scans',
  'Photos18',
  'MangaCloud',
  'Darths & Droids',
  'Dusk Scans',
];

interface Probe {
  name: string;
  total: number;
  matched: number;
  errors: Record<string, number>;
  matchedTitles: string[];
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Un match vide apres normalisation ne prouve rien : Photosa18 renvoie ses
 * resultats en chinois ("动力链锯恶魔"), dont le normalise ASCII est vide. Sans
 * cette garde, une sourceReturning du CJK compterait comme un succes.
 */
const isMeaningful = (s: string) => normalize(s).length >= 3;

async function probeOne(name: string): Promise<Probe> {
  const errors: Record<string, number> = {};
  let matched = 0;
  let total = 0;
  const matchedTitles: string[] = [];

  for (const title of TITLES) {
    total++;
    try {
      const scraper = await getScraper(name);
      if (!scraper) {
        errors['scraper-introuvable'] = (errors['scraper-introuvable'] ?? 0) + 1;
        continue;
      }
      const result = await scraper.getSearch(title, 1);
      const hit = result.mangas.find((m) => {
        if (!isMeaningful(m.title) || !isMeaningful(title)) return false;
        const a = normalize(m.title);
        const b = normalize(title);
        return a.includes(b) || b.includes(a);
      });
      if (hit) {
        matched++;
        matchedTitles.push(`${title} -> "${hit.title}"`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = message.match(/status code (\d{3})/)?.[1]
        ?? (/ENOTFOUND/.test(message) ? 'DNS'
          : /timeout|ETIMEDOUT|ECONNABORTED/i.test(message) ? 'timeout'
            : /not supported|not implemented/i.test(message) ? 'non-implementé'
              : message.slice(0, 40));
      errors[code] = (errors[code] ?? 0) + 1;
    }
  }

  return { name, total, matched, errors, matchedTitles };
}

async function run(label: string): Promise<Probe[]> {
  console.log(`\n===== SONDE ${label} =====`);
  const results: Probe[] = [];
  // Sequentiel : en parallele on saturerait l'IP et on confondrait rate-limit
  // avec blocage, ce qui est exactement la faute qu'on cherche a eviter.
  for (const name of SAMPLE) {
    const p = await probeOne(name);
    results.push(p);
    const errs = Object.entries(p.errors).map(([k, v]) => `${k}x${v}`).join(' ') || 'aucune';
    console.log(
      `  ${p.name.padEnd(20)} match=${p.matched}/${p.total}  erreurs: ${errs}`,
    );
  }
  return results;
}

function report(label: string, results: Probe[]): string {
  const ok = results.filter((r) => r.matched > 0).length;
  const rows = results
    .map((r) => {
      const errs = Object.entries(r.errors).map(([k, v]) => `${k}×${v}`).join(', ') || '—';
      return `| ${r.name} | ${r.matched}/${r.total} | ${errs} | ${r.matchedTitles[0] ?? '—'} |`;
    })
    .join('\n');
  return [
    `### Sonde « ${label} »`,
    '',
    `Sources ayant trouvé au moins un titre : **${ok}/${results.length}**`,
    '',
    '| Source | Matchs | Erreurs | Exemple |',
    '|---|---|---|---|',
    rows,
  ].join('\n');
}

async function main() {
  const all = listScrapers();
  console.log(`Scrapers enregistrés : ${all.length}`);
  console.log(`Titres sondés : ${TITLES.join(' | ')}`);

  const ip = await fetch('https://api.ipify.org').then((r) => r.text()).catch(() => 'inconnue');
  console.log(`IP de sortie : ${ip}`);

  const results = await run(process.argv[2] ?? 'run');

  const summary = [
    '## Diagnostic egress scrapers',
    '',
    `IP de sortie : \`${ip}\``,
    '',
    report(process.argv[2] ?? 'run', results),
  ].join('\n');

  const { GITHUB_STEP_SUMMARY } = process.env;
  if (GITHUB_STEP_SUMMARY) {
    const fs = await import('fs');
    fs.appendFileSync(GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  console.log(`\n${summary}`);

  // Toujours 0 : un diagnostic ne doit pas faire rougir le pipeline.
  process.exit(0);
}

main();
