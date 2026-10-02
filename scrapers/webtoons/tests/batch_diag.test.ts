import test from 'node:test';
import assert from 'node:assert';
import { classifyOrigin, classifyNetworkError, describeProbe } from './origin_diagnose';

// Ces tests verrouillent des décisions qui figent des sites dans
// SOURCES_NON_SCRAPPABLES.md. Chaque cas correspond à une réponse réellement
// observée sur un site, donc les corps sont recopiés à l'identique plutôt
// qu'inventés : c'est le détail (« error code: 1026 ») qui évite le faux verdict.

const APACHE_404_173 = `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">
<html><head>
<title>404 Not Found</title>
</head><body>
<h1>Not Found</h1>
<p>The requested URL was not found on this server.</p>
</body></html>
`;

test('un domaine expiré servant un 200 minuscule est DEAD, pas OK', () => {
  // niadd.com : transport 200, corps 173 o = page d'erreur Apache.
  const r = classifyOrigin(200, APACHE_404_173);
  assert.strictEqual(r.verdict, 'DEAD');
  assert.match(r.detail, /page d'erreur/);
});

test('un 200 minuscule sans challenge est BLOCKED, pas un port cassé', () => {
  // mangago.me : coquille de 477 o. Le port est inutilisable, mais la cause
  // n'est pas le parsing — le dire « port à corriger » enverrait quelqu'un
  // réécrire un parseur déjà correct.
  const r = classifyOrigin(200, '<html><head></head><body>' + 'x'.repeat(400) + '</body></html>');
  assert.strictEqual(r.verdict, 'BLOCKED');
  assert.match(r.detail, /coquille/);
});

test('un challenge Cloudflare est BLOCKED', () => {
  const body = '<html><head><title>Just a moment...</title></head><body>' + 'y'.repeat(5000) + '</body></html>';
  const r = classifyOrigin(403, body);
  assert.strictEqual(r.verdict, 'BLOCKED');
  assert.match(r.detail, /451|403/);
});

test('451 code 1026 est un bannissement d\'ASN, pas un verdict de site', () => {
  // Régression : baobua.net et kiutaku.com (site VIVANT, port déjà livré)
  // renvoient tous deux exactement cette réponse. Si ce cas était classé
  // DEAD, on inscrirait un site vivant comme mort dans le registre.
  const r = classifyOrigin(451, 'error code: 1026');
  assert.strictEqual(r.verdict, 'BLOCKED');
  assert.match(r.detail, /ASN/);
  assert.match(r.detail, /pas un verdict site/);
});

test('un 451 sans code 1026 reste un blocage générique', () => {
  const r = classifyOrigin(451, '<html>Unavailable For Legal Reasons</html>');
  assert.strictEqual(r.verdict, 'BLOCKED');
  assert.doesNotMatch(r.detail, /ASN/);
});

test('un 202 à zéro octet est BLOCKED (anti-bot front)', () => {
  const r = classifyOrigin(202, '');
  assert.strictEqual(r.verdict, 'BLOCKED');
});

test('un catalogue qui répond est ALIVE', () => {
  const body = '<html><body>' + 'manga-item '.repeat(500) + '</body></html>';
  const r = classifyOrigin(200, body);
  assert.strictEqual(r.verdict, 'ALIVE');
});

test('410 est DEAD', () => {
  const r = classifyOrigin(410, 'gone');
  assert.strictEqual(r.verdict, 'DEAD');
});

test('describeProbe rend un préfixe exploitable par le résumé', () => {
  assert.match(describeProbe({ verdict: 'DEAD', detail: 'x' }), /^site mort/);
  assert.match(describeProbe({ verdict: 'BLOCKED', detail: 'x' }), /^site bloqué/);
  assert.match(describeProbe({ verdict: 'ALIVE', detail: 'x' }), /^site vivant/);
  assert.match(describeProbe({ verdict: 'UNKNOWN', detail: 'x' }), /^origine indéterminée/);
});

// Erreurs de transport : le registre est durable, donc un verdict fondé sur la
// connectivité du runner — et non sur le site — y inscrit un faux positif.
// Messages recopiés depuis des échecs réellement observés sur ce projet.

function netErr(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

test('un NXDOMAIN est le seul échec DNS qui vaut DEAD', () => {
  const r = classifyNetworkError(netErr('ENOTFOUND', 'getaddrinfo ENOTFOUND niadd.com'));
  assert.strictEqual(r.verdict, 'DEAD');
  assert.match(r.detail, /introuvable/);
});

test('EAI_AGAIN est transitoire et ne vaut pas DEAD', () => {
  // Le résolveur a renoncé, pas le domaine : un EAI_AGAIN sur une sortie
  // locale contaminée ferait disparaître un site vivant du registre.
  const r = classifyNetworkError(netErr('EAI_AGAIN', 'getaddrinfo EAI_AGAIN baobua.net'));
  assert.strictEqual(r.verdict, 'UNKNOWN');
});

test('timeout et reset réseau ne valent pas DEAD', () => {
  const codes = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH'];
  const messages = [
    'connect ETIMEDOUT 104.21.77.96:443',
    'socket hang up',
    'connect ECONNREFUSED 104.21.77.96:443',
    'connect EHOSTUNREACH 104.21.77.96:443',
    'connect ENETUNREACH 104.21.77.96:443',
  ];
  for (let i = 0; i < codes.length; i++) {
    const r = classifyNetworkError(netErr(codes[i], messages[i]));
    assert.strictEqual(r.verdict, 'UNKNOWN', `${codes[i]} ne doit pas valoir DEAD`);
    assert.match(r.detail, /pas un verdict site/);
  }
});

test('une erreur TLS reste UNKNOWN, pas DEAD', () => {
  const r = classifyNetworkError(netErr('ECONNRESET', 'wrong version number'));
  assert.strictEqual(r.verdict, 'UNKNOWN');
});

test('un 451 reçu au niveau transport reste BLOCKED', () => {
  const r = classifyNetworkError(netErr('ERR_BAD_RESPONSE', 'Request failed with status code 451'));
  assert.strictEqual(r.verdict, 'BLOCKED');
  assert.match(r.detail, /451/);
});

test('describeProbe distingue un échec transport d\'un site mort', () => {
  assert.match(
    describeProbe(classifyNetworkError(netErr('ETIMEDOUT', 'connect ETIMEDOUT 1.2.3.4:443'))),
    /^origine indéterminée/,
  );
});