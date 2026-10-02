import axios from 'axios';
import dns from 'node:dns';
import { Agent } from 'node:https';
import type { LookupFunction } from 'node:net';

// Diagnostic d'origine : répond à la seule question qui compte quand un port
// renvoie zéro résultat — « le site existe encore, ou c'est le port qui est cassé ? »
//
// Ce module est séparé de batch_test.ts pour deux raisons : il doit être testable
// sans lancer un batch réseau, et ses verdents figent des sites dans un registre
// durable (SOURCES_NON_SCRAPPABLES.md), donc ils ne doivent dépendre d'aucun état
// global.

const PROBE_TIMEOUT_MS = 15_000;

// Beaucoup de domaines ont une route IPv6 qui répond alors que le site est mort, ou
// l'inverse : sans IPv4 forcé, la sonde conclut « 000 » sur un site parfaitement
// vivant. On force donc la famille 4 pour que le diagnostic soit reproductible.
const ipv4Lookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, family: 4 }, callback);
};

const ipv4Agent = new Agent({ lookup: ipv4Lookup, keepAlive: false });

export type OriginVerdict = 'ALIVE' | 'DEAD' | 'BLOCKED' | 'UNKNOWN';

export type OriginProbe = { verdict: OriginVerdict; detail: string };

const ORIGIN_ERROR_PAGE = /<\s*title[^>]*>\s*(404|403|410|error|not found|forbidden)/i;
const ORIGIN_CHALLENGE =
  /just a moment|checking your browser|enable javascript|attention required|cf-challenge|ddos protection/i;
const ORIGIN_ASN_BLOCK = /error code:\s*1026/i;

// Seuil sous lequel une page d'accueil 200 ne peut pas être un site de manga qui
// sert du contenu : le plus petit catalogue plausible dépasse largement 2 ko.
// En dessous, c'est une coquille, un challenge ou un stub — dans tous les cas
// le port ne peut pas fonctionner, mais pour une raison qu'il faut nommer.
const MIN_CONTENT_BYTES = 2048;

/**
 * Classe une réponse d'origine en verdict, sans toucher au réseau.
 *
 * Volontairement pure et exportée : chaque verdict est une décision qui fige un
 * site dans le registre, donc elle doit être vérifiable sans lancer de scraper
 * (voir batch_diag.test.ts).
 */
export function classifyOrigin(code: number, body: string): OriginProbe {
  const size = body.length;

  // Un domaine expiré sert souvent un 200 avec un corps d'erreur minuscule
  // (ex. Apache « 404 Not Found » en 155 o). C'est le cas le plus trompeur :
  // le transport réussit, donc un simple test HTTP dirait « OK ».
  if (ORIGIN_ERROR_PAGE.test(body) && size < MIN_CONTENT_BYTES) {
    return { verdict: 'DEAD', detail: `page d'erreur servie en ${code}, corps ${size} o` };
  }
  if (code === 410) {
    return { verdict: 'DEAD', detail: 'HTTP 410' };
  }
  if (code === 403 || code === 429 || code === 451) {
    // 451 + « error code: 1026 » = bannissement d'ASN Cloudflare. C'est un fait
    // sur le runner, pas sur le site : baobua.net et kiutaku.com (site vivant,
    // port déjà livré) renvoient exactement la même réponse. On le nomme pour
    // que personne ne conclue « site mort » à partir d'un 451.
    const asnBlock = ORIGIN_ASN_BLOCK.test(body);
    return {
      verdict: 'BLOCKED',
      detail: asnBlock
        ? 'HTTP 451 code 1026 (bannissement ASN Cloudflare, pas un verdict site)'
        : `HTTP ${code}, corps ${size} o`,
    };
  }
  if (code === 202 && size === 0) {
    return { verdict: 'BLOCKED', detail: 'HTTP 202 à 0 octet (anti-bot)' };
  }
  // Un 200 minuscule avec un challenge Cloudflare est un blocage, pas un site qui
  // aurait changé : le port n'est pas réparable en corrigeant le parseur, il faut
  // un accès navigateur.
  if (ORIGIN_CHALLENGE.test(body)) {
    return { verdict: 'BLOCKED', detail: `challenge anti-bot en ${code}, corps ${size} o` };
  }
  if (code >= 200 && code < 300 && size < MIN_CONTENT_BYTES) {
    return {
      verdict: 'BLOCKED',
      detail: `coquille de ${size} o en ${code} (sous le seuil de contenu ${MIN_CONTENT_BYTES} o)`,
    };
  }
  if (code >= 200 && code < 300) {
    return { verdict: 'ALIVE', detail: `HTTP ${code}, corps ${size} o` };
  }
  return { verdict: 'UNKNOWN', detail: `HTTP ${code}, corps ${size} o` };
}

/**
 * Classe une erreur de transport en verdict, sans toucher au réseau.
 *
 * Distingue volontairement « le domaine a disparu » de « le réseau du runner a
 * échoué ». Un timeout, un reset ou `EAI_AGAIN` ne disent rien du site : sur une
 * sortie locale contaminée ou throttlée, ce sont précisément les codes que l'on
 * reçoit pour des sites parfaitement vivants. Les classer `DEAD` fait disparaître
 * un site du registre sur une preuve qui ne le concerne pas.
 *
 * Seul `ENOTFOUND` (NXDOMAIN) est une preuve directe de disparition du domaine,
 * parce que la résolution a bien abouti et que l'absence a été constatée par le
 * résolveur.
 */
export function classifyNetworkError(err: unknown): OriginProbe {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string } | null)?.code ?? '';

  // NXDOMAIN : le nom n'existe pas. Seul cas où la mort du domaine est établie.
  if (code === 'ENOTFOUND' || (code === '' && /\bENOTFOUND\b/i.test(msg))) {
    return { verdict: 'DEAD', detail: `DNS: domaine introuvable (${msg.slice(0, 60)})` };
  }
  // Echecs transitoires : réseau runner, pas état du site.
  if (/EAI_AGAIN|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EPIPE|socket hang up|wrong version number|TLS|certificate/i.test(msg)) {
    return {
      verdict: 'UNKNOWN',
      detail: `échec transport (pas un verdict site) : ${msg.slice(0, 60)}`,
    };
  }
  // 451 reste un fait réseau : c'est le runner qui est banni, pas le site.
  if (/451/i.test(msg)) {
    return { verdict: 'BLOCKED', detail: `HTTP 451 au niveau transport : ${msg.slice(0, 60)}` };
  }
  return { verdict: 'UNKNOWN', detail: msg.slice(0, 60) };
}

/** Sonde l'origine d'un scraper et renvoie son verdict. */
export async function probeOrigin(baseUrl: string): Promise<OriginProbe> {
  try {
    const res = await axios.get(baseUrl, {
      timeout: PROBE_TIMEOUT_MS,
      maxRedirects: 5,
      responseType: 'text',
      // Sans cela axios rejette 403/429/451 avant classifyOrigin, et le verdict
      // repose alors sur le texte d'erreur plutôt que sur le statut HTTP réel.
      validateStatus: () => true,
      // responseType 'text' peut renvoyer un objet si le site sert du HTML en
      // buffer ; on normalise pour ne lire que le corps textuel.
      transformResponse: [(b: unknown) => (typeof b === 'string' ? b : '')],
      httpsAgent: ipv4Agent,
      httpAgent: ipv4Agent,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    return classifyOrigin(res.status, typeof res.data === 'string' ? res.data : '');
  } catch (err: unknown) {
    return classifyNetworkError(err);
  }
}

/** Phrase actionable pour le résumé de batch_test, à partir d'un verdict brut. */
export function describeProbe(probe: OriginProbe): string {
  switch (probe.verdict) {
    case 'DEAD':
      return `site mort — ${probe.detail}`;
    case 'BLOCKED':
      return `site bloqué — ${probe.detail}`;
    case 'ALIVE':
      return `site vivant, port à corriger — ${probe.detail}`;
    default:
      return `origine indéterminée — ${probe.detail}`;
  }
}