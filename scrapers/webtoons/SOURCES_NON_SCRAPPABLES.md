# Sources non scrappables

Registre des sources upstream Keiyoushi **volontairement non portées**, avec la preuve
qui a motivé la décision. Ce fichier est la mémoire durable des verdicts `IGNORE` — et des
`UNKNOWN`, qu'on refuse d'écrire comme des `IGNORE` : sans lui, un verdict ne vit que dans
un commentaire d'issue fermée, donc il n'est ni requêtable ni rejouable, et un domaine
racheté ne revient jamais dans le radar.

Chaque entrée est un fait vérifié, avec une **condition de revivification** explicite.
Tant que cette condition n'est pas remplie, on ne retente pas.

> **Les ports `.ts` de ces sources sont volontairement absents.** Aucun fichier mort n'est
> commité pour une source listée ici : un port qui n'a jamais rien retourné n'est pas un
> point de départ, c'est du bruit qui fait croire à un travail fait.

## Règle de décision

Une source est `IGNORE` si, et seulement si, elle reste inutilisable **depuis la CI**
**pour une raison qui tient au site, pas à notre position réseau** :

| Motif | Test qui le prouve | Exemple |
|---|---|---|
| Domaine mort | DNS NXDOMAIN, ou corps 404/410 permanent sur toutes les routes | vizshonenjump |
| Domaine abandonné / en vente | Le domaine répond, mais sert une page « for sale » ou de parking | voyceme, firescans, mangabtt |
| Interstitiel JS / SPA | HTML de 4 ko sans contenu, données rendues en JS | hdoujin |
| Moteur de navigateur requis | Lecteur WebView, descrambler JS, ou contenu chiffré côté client | japscan, mangaplaza |
| Mur d'authentification | API refuse sans token/cookie de session | hanabook, ono |

Aucun contournement infini : si le round-trip de cookie échoue une fois, `IGNORE`.

**Ce qui ne suffit jamais, à lui seul :**

| Signal | Ce qu'il prouve réellement | Verdict correct |
|---|---|---|
| `451`, `403`, `429`, `000` | Un runner en datacenter est banni ou bridé ; le site peut servir tout le reste | `UNKNOWN` |
| TLS instable, timeout, reset | Souvent le réseau du runner, pas le site | `UNKNOWN` |
| Anti-bot sans preuve propriétaire | Idem : il faut que le blocage survive à un WARP | `UNKNOWN` |

`hentailoop.com` est l'exemple de référence : son `000` venait du résolveur du
sandbox et son 403 Cloudflare de sa propre IP. Le domaine est vivant et Cloudflare,
donc `BLOCKED` — pas `IGNORE`. Le retrait est dans la section « Deux sources
retirées ».

**Un 451 ou un 403 ne devient jamais une ligne du registre sans une confirmation WARP.**
La seule chose qu'un 451 prouve, sans WARP, est que *ce runner* est banni. Voir piège n° 3.

## Registre

État vérifié les **2026-10-01** et **2026-10-02**, en IPv4 (`curl -4`), **sans WARP**.
Les cinq entrées `voyceme`, `coffeemanga`, `firescans`, `mangabtt`, `vizshonenjump`
ont été resondées le 2026-10-02 à partir de l'historique Git et sont des verdicts
positifs (« domaine mort »), pas des déductions de commit.

> ⚠️ Ce tableau a été revu après coup : la première version classait `baobua` en `IGNORE`
> sur un 451. C'était faux, et c'est exactement l'erreur que ce registre doit empêcher.
> La preuve est conservée dans la ligne, pas effacée.

| Extension | Domaine upstream | Verdict | Preuve | Condition de revivification |
|---|---|---|---|---|
| `all/hdoujin` | `hdoujin.org` | IGNORE | HTTP 200 mais **4 000 o** d'interstitiel contenant un cookie `cf-` ; l'API exige un token `clearance` obtenu via WebView | L'API répond sans token `clearance` |
| `all/voyceme` | `voyceme.com` | IGNORE | `voyceme.com` répond toujours **200** avec la page **« voyceme.com for sale \| Spaceship.com »** (17 516 o) : l'ancien domaine est en vente et ne sert plus de catalogue. L'extension upstream `en/voyceme`, distincte et pointée sur `https://www.voyce.me`, reste un port séparé à traiter | Le domaine `voyceme.com` ressert un catalogue lisible |
| `en/coffeemanga` | `coffeemanga.com` | IGNORE | `301` puis `coffeemanga.ink` qui répond **404 « Not Found »** (1 249 o) : l'ancien domaine ne redirige plus vers rien | `/` ressert un catalogue lisible |
| `en/firescans` | `firescans.com` | IGNORE | `302` puis `hugedomains.com/domain_profile.cfm?d=firescans.com` → **« FireScans.com is for sale »** (200, 54 319 o) | Le domaine est racheté et ressert un vrai catalogue |
| `en/mangabtt` | `mangabtt.com` (ex `manhwabtt.cc`) | IGNORE | HTTP 200 mais page de **parking** de 3 901 o, sans catalogue | Le domaine est racheté et ressert un vrai catalogue |
| `en/mangaplaza` | `mangaplaza.com` + `reader.mangaplaza.com` | IGNORE | Site vivant (200, 2,4 Mo) mais le lecteur impose `SpeedBinb` (déchiffrement), et l'API `sws/apis/bibGetCntntInfo.php` répond `{"result":-100,"code":"E00006"}` avec un mur login + achat de chapitre | Un lecteur gratuit et non chiffré devient accessible sans WebView |
| `en/vizshonenjump` | `vizshonenjump.com` | IGNORE | **NXDOMAIN** sur les résolveurs publics (1.1.1.1, 8.8.8.8) : le domaine n'existe plus | Le domaine est réenregistré et ressert un vrai catalogue |
| `fr/hanabook` | `www.hana-book.fr` + `api.hana-book.fr` | IGNORE | Site vivant (200, 79 826 o) mais l'API `api-ebook/v14/catalogue/?page=1` répond **403** `{"success":false,"message":"Access Forbidden"}` ; l'upstream exige un token de session | L'API catalogue s'ouvre sans token |
| `fr/japscan` | `www.japscan.foo` | IGNORE | Site **vivant** (200, 2 166 813 o) — l'upstream pointe déjà sur `.foo`, donc le domaine n'est pas la cause. Le lecteur exige un WebView + descrambler JS (`ReaderScripts.kt`) | Les URLs de pages du lecteur deviennent lisibles sans WebView |
| `fr/ono` | `www.ono.live` + `ws.ono.live` | IGNORE | HTTP **202 à 0 octet** (CloudFront anti-bot) ; l'API GraphQL exige un JWT Cognito extrait des cookies du site | `ws.ono.live/graphql` répond sans en-tête `Authorization` |
| `en/mangabay` | `manga-bay.biz` | IGNORE | Sondé le 2026-10-04 (`curl -4`, via WARP puis `--noproxy '*'`) : `/` répond une page d'attente JS (spinner, `token mode modern`, contrôle `webdriver`/`hasCrypto`) sans catalogue ; l'upstream ne la franchit que via `runWebViewBlocking` (`DleGuardResolver.kt`, cookie `__guard_trust`). Re-sonde du 2026-10-23 : `302` vers `/_c?t=<token>&u=https%3A%2F%2Fmanga-bay.biz%2F`, cible `404` — le garde DLE persiste, verdict maintenu | Le garde DLE sert un vrai catalogue sans WebView (ou le cookie `__guard_trust` devient calculable sans navigateur) |
| `all/komga` | `https://127.0.0.1:25600` | IGNORE | Source **auto-hébergée** : `Komga.kt` (issue #429) lit `baseUrl`, identifiants et clé API depuis les préférences utilisateur (`PREF_ADDRESS`, vide par défaut) et n'est utilisable que sur le propre serveur Komga de l'utilisateur. Sonde 2026-10-08 : `https://127.0.0.1:25600` → `000`, aucun catalogue public documenté | Une instance Komga publique sans authentification exposée |
| `en/comix` | **candidat BUILD** — voir « Critère de portabilité » | **Retire du registre** | Le premier verdict (`IGNORE` pour `comix`, `BLOCKED` pour `aniverse`) jugeait la source sur le lecteur du site : WebView, chiffrement, signature des requetes. Or la pipeline n'ingère que `rootUrl`, l'URL de la serie. Catalogue et URL de fiche sont lisibles en HTTP simple pour les deux | n/a |

### Sources vivantes derrière un challenge Cloudflare : `BLOCKED`, pas `IGNORE`

Ces quatre entrées **ne sont pas classées `IGNORE`**, et c'est le point principal de cette
section. Un `IGNORE` affirme que la source est morte ; rien ici ne le prouve. Ces sites
répondent, ils sont en ligne, et un navigateur les ouvre. Ce qui manque, c'est notre
capacité à les franchir : `axios` + `cheerio` n'exécutent ni JavaScript, ni fingerprint
TLS, et n'obtiennent jamais de `cf_clearance`.

Pourquoi `IGNORE` serait un verdict faux ici, alors que `en/mangabay` est bien `IGNORE`
plus haut : mangabay exige un `WebView` **et** un descrambler, c'est-à-dire une
architecture que ce dépôt n'a pas et n'est pas hostile à à avoir — le garde est la seule
voie, donc la source est hors d'atteinte par conception. Ici le challenge est standard et
se lève avec un simple navigateur : le registre mesure notre outillage, pas la santé des
sites. Classer ces sources en `IGNORE` les ferait disparaître de tout radar alors qu'elles
sont parfaitement portables, et donc des ports qui réussiront le jour où le dépôt gagnera
un chemin anti-bot. C'est le piège que la règle refuse : sans cette ligne, un verdict ne
vit que dans un commentaire d'issue fermée, donc il n'est ni requêtable ni rejouable.

Sondé le **2026-10-05**, en IPv4 (`curl -4`), sans WARP. Les quatre réponses sont le même
challenge, ~5,4 ko, `cf-ray` en `CDG` (Paris) pour les trois domaines distincts.

| Extension | Domaine upstream | Verdict | Preuve | Condition de revivification |
|---|---|---|---|---|
| `en/theblank` | `theblank.net` | BLOCKED | `403` + **5 446 o**, `<title>Just a moment...</title>`, en-têtes `server: cloudflare` et **`cf-mitigated: challenge`** (`cf-ray: a45ee8144da13ce1-CDG`) : challenge Cloudflare interactif, aucun catalogue dans le corps | Un `GET` sans navigateur rend un catalogue lisible (bascule en Defensive mode, ou `cf_clearance` obtenable sans JS) |
| `fr/astralmanga` | `astral-manga.fr` | BLOCKED | `403` + **5 470 o**, `Just a moment...`, `cf-mitigated: challenge` (`cf-ray: a45ee814b8cf9dae-CDG`) — identique au précédent | idem |
| `fr/softepsilonscan` | `epsilonsoft.to` | BLOCKED | `403` + **5 469 o**, `Just a moment...`, `cf-mitigated: challenge` (`cf-ray: a45ee8151c7a2a10-CDG`) | idem |
| `fr/epsilonscan` | `epsilonsoft.to` | BLOCKED | **Même domaine que `fr/softepsilonscan`** : les deux `build.gradle.kts` upstream pointent sur `epsilonsoft.to`, donc deux sources logiques sur une seule origine. Réponse identique à la précédente (`403`, 5 469 o) | Une seule fois la condition d'`fr/softepsilonscan` remplie, les deux sont portables : ne pas les re-sonder séparément |

Sondé le **2026-10-14** (issue #460), en IPv4 (`curl -4`), via WARP puis `--noproxy '*'` :
les trois réponses sont identiques sur les deux routes — un défi Cloudflare en face
de la racine, donc aucun catalogue ni aucune URL de fiche n'est atteignable en HTTP
simple. Le moniteur les signalait `OUI (Cloudflare)` ; la sonde le confirme.

| Extension | Domaine upstream | Verdict | Preuve | Condition de revivification |
|---|---|---|---|---|
| `en/battleinfivesecondsaftermeeting` | `www.deatte5.com` | BLOCKED | `403` + **4 546 o**, `<title>Attention Required! \| Cloudflare</title>`, identique via WARP et sans tunnel | idem |
| `en/porncomix` | `bestporncomix.com` | BLOCKED | `403` + **5 312 o**, `<title>Just a moment...</title>`, **`cf-mitigated: challenge`** (`cf-ray: a4a6512268095938-IAD`), identique via WARP et sans tunnel | idem |

Sondé le **2026-10-15** (issue #469), en IPv4 (`curl -4`), via WARP puis `--noproxy '*'` :
même situation que les trois précédentes — défi Cloudflare sur la racine **et** sur
l'API catalogue (`/cdn/v1/browse`), donc aucun catalogue ni aucune URL de fiche
n'est atteignable en HTTP simple. L'upstream ne franchit ce mur qu'avec un token
Turnstile navigateur (`getTurnstileToken`) plus un déchiffrement d'images : c'est
une propriété du site servi sans JS, pas de notre IP. Verdict `UNKNOWN`, pas `IGNORE`.

| Extension | Domaine upstream | Verdict | Preuve | Condition de revivification |
|---|---|---|---|---|
| `en/toonkotsu` | `toonkotsu.com` | BLOCKED | `/` → `403` + **5 329 o**, `<title>Just a moment...</title>`, identique via WARP et sans tunnel ; `/cdn/v1/browse?sort=popular&order=desc&page=1&limit=5` → même défi (`403`, 5 844 o) | Un `GET` sans navigateur rend un catalogue lisible |

#### Pourquoi ces quatre ne sont pas portées maintenant

Un port `BaseScraper` fait `axios.get()` puis `cheerio.load()`. Face à `cf-mitigated:
challenge`, il recevrait 5,4 ko de page d'attente, `getSearch()` renverrait
`{ mangas: [], hasNextPage: false }`, et le worker classerait le job en `no_match` après 3
essais. Autrement dit : un fichier commité qui ne retourne jamais rien, et un media marqué
« absent des sources » alors qu'il existe. C'est exactement le « bruit qui fait croire à
un travail fait » que l'en-tête du registre interdit.

Trois voies, par ordre de rapport coût/résultat, quand on voudra les porter :

1. **Navigateur** — réutiliser ce que `scrapling-worker` fait déjà pour les jeux
   (`Fetcher.get` + Playwright/patchright). Ce worker est aujourd'hui games-only ; lui
   ouvrir les mangas est le prolongement le moins coûteux, et un `cf_clearance` récupéré
   via navigateur permettrait ensuite de repasser en `cheerio` pour le gros du volume.
2. **Résoudre le challenge à la main, une fois** — un `cf_clearance` est lié à l'IP et de
   TTL court : il ne tient ni en CI ni plusieurs heures. À ne tenter que pour du one-shot.
3. **Attendre un basculement du site en Defensive mode** — c'est la condition déjà
   inscrite dans le tableau, et la seule qui ne demande aucun code.

#### Ce qui a été vérifié avant d'écrire cette section

Le diagnostic ne s'est pas arrêté à « ça ne marche pas en local ». Il a été fait sur runner
GitHub, avec et sans WARP, parce que la piste « l'IP du runner est bannie » avait déjà
produit un faux verdict dans ce dépôt :

- **A/B sur le même runner** (`.github/workflows/diagnose-scraper-egress.yml`, run
  `37357165963`, supprimé depuis) : à IP WARP `104.28.201.80` et à IP nue
  `172.184.209.180`, `MangaKatana` et `MangaRead` répondent à l'identique. Le WARP ne
  débloque ni ne dégrade rien : **un 403 sans WARP ne prouve donc rien** sur ces sites.
- **Ce qui reste vrai malgré tout** : ces quatre renvoient `cf-mitigated: challenge`, qui
  est une décision Cloudflare explicite, et non une banni d'IP comparable au `1026`. La
  nuance compte : un `1026` se contourne, un `cf-mitigated: challenge` non sans navigateur.

### `fr/aniverse` : catalogue lisible, mais aucune URL de fiche

`BLOCKED`, et pour une raison qui n'a **rien à voir avec Cloudflare** : cette source
n'est pas un mur anti-bot. Elle est dans une situation plus simple et plus
embêtante, celle d'un site dont on peut lire le catalogue sans pouvoir citer une fiche.

L'issue #419 la classe `OUI (Cloudflare)`, c'est faux et la sonde le corrige :
`/home` répond **200**, sans challenge ni `cf-mitigated`. C'est un Next.js, et son
catalogue est bien présent — 26 séries avec des objets complets (titre français, anglais,
romaji, natif, image TMDB, nombre d'épisodes, note). Toutes les données nécessaires à un
port y sont.

Ce qui manque, c'est le point d'entrée du scraper : **l'URL de la fiche**.

| Route sondée | Réponse | Contenu |
|---|---|---|
| `/home` | 200 | catalogue complet dans le payload RSC |
| `/manga` | 200 | payload **vide** (hydratation côté client) |
| `/<slug>` | **404** | aucune fiche par slug |
| `/catalogue` | **404** | — |
| `/api`, `/api/home`, `/_next/data` | **404** | aucune API |
| format d'URL dans les chunks JS | absent | rien qui ressemble à `/manga/...` ou `/watch/...` |

Le worker n'ingère qu'une URL par source (`result.rootUrl`). Sans format d'URL de fiche
connu, un port ne peut produire que des URL inventées, qui 404 à l'ingestion. On
retombait donc soit sur une liste vide — un media marque « absent des sources » alors
qu'il existe — soit sur un fichier commité qui ne fonctionne pas.

Un port qui irait chercher le payload RSC de `/home` fonctionnerait au moment présent,
et casserait à la prochaine mise à jour de Next.js : la structure des chunks fait partie
de l'implémentation interne du framework, pas de son contrat. Le registre mesure la
robustesse, pas la validité dans le temps d'un scrape.

| Extension | Domaine upstream | Verdict | Preuve | Condition de revivification |
|---|---|---|---|---|
| `fr/aniverse` | **candidat BUILD** — voir « Critère de portabilité » | **Retire du registre** | Le premier verdict (`IGNORE` pour `comix`, `BLOCKED` pour `aniverse`) jugeait la source sur le lecteur du site : WebView, chiffrement, signature des requetes. Or la pipeline n'ingère que `rootUrl`, l'URL de la serie. Catalogue et URL de fiche sont lisibles en HTTP simple pour les deux | n/a |

À noter pour le prochain passage : le domaine de l'issue est `aniverse.fr`, et la
redirection `307` de la racine pointe vers `/home`. Un agent qui sondera `/` sans suivre
la redirection verra une page quasi vide (1 seul lien, 451 ko de JS) et conclura trop vite
à un interstitiel.

### Ce que l'historique Git ne dit pas, et qu'il ne faut pas en déduire

`git log --diff-filter=D` fait apparaître **139** ports supprimés. Ce nombre est un
piège : il ne compte pas des sites morts.

- **Les 39 de #373 n'étaient pas des sites morts**, mais des *stubs* : leurs trois
  méthodes de liste ne contenaient que le littéral vide. Le commit dit lui-même
  « les 39 sites redeviennent des NOUVEAU que le pipeline peut transcrire ». Les
  inscrire ici aurait créé 39 faux `IGNORE` et enterré 39 candidats `BUILD`.
- **`96af6e5` n'est pas un nettoyage** : c'est une refonte de 80 fichiers qui
  déplace et supprime des sources en même temps. Ses suppressions sont des
  restructurations, pas des verdicts.
- `2c00c16` et `7022332` sont le même lot sous deux refs : ne pas le compter deux fois.

Conséquence : une suppression n'est un verdict que si le commit **ou une sonde**
donne une propriété du site. Les suppressions sans preuve restent des candidats
`BUILD`, et ne doivent réapparaître ici qu'après une sonde sur leur domaine.

### Contrôle des suppressions historiques : le motif du commit était souvent faux

Ces ports ont été supprimés en 2026 sur la base du motif écrit dans le commit.
Resondés le 2026-10-02 (IPv4, sans WARP), **la plupart sont alive et servent un
vrai catalogue** : les inscrire ici aurait créé autant de faux `IGNORE`.

| Domaine sondé | Motif du commit | Sonde 2026-10-02 | Verdict |
|---|---|---|---|
| `asmhentai.com` | « 404 » | 200, 30 009 o, 153 liens, catalogue complet | **vivant** |
| `hentairox.com` | « 404 » | 200, 37 877 o, 162 liens | **vivant** |
| `hentaizap.com` | « 404 » | 200, 53 162 o, 216 liens | **vivant** |
| `www.mangabats.com` | « 404 » | 200, 233 996 o, 428 liens | **vivant** |
| `imhentai.xxx` | « 404 » | **HTTP 200, 3 776 o** (le 000 venait du HTTPS/TLS) | **vivant** |
| `nhentai.xxx` | « Cloudflare » | 200, 34 484 o, 80 liens | **vivant** |
| `hentai.scanreader.net` | « Cloudflare » | 200, 321 012 o, 144 liens | **vivant** |
| `rimuscan.fr` | « Cloudflare » | 200, 798 596 o, 122 liens | **vivant** |
| `www.natomanga.com` | « Cloudflare » | 200, 245 316 o, 426 liens | **vivant** |
| `vymanga.net` | « Cloudflare » | 200 → redirige vers `everythingmoe.com/s/vyvymanga` (miroir officiel) | **vivant, sur un miroir** |
| `allmanga.to` | `AA_CRYPTO_MISSING` | 200 mais 5 516 o et 21 liens : interstitiel SPA, le contenu est rendu en JS | `BUILD` seulement avec navigateur |
| `mangaplus.shueisha.co.jp` | API protobuf | 200 mais 2 350 o : SPA, catalogue rendu en JS | `BUILD` seulement avec navigateur |
| `astral-manga.fr` | « Cloudflare » | **403 « Just a moment… »** (défi Cloudflare) | **indéterminé** — voir ci-dessous |
| `phenix-scans.co` | « Cloudflare » | **523**, 16 o : Cloudflare ne joint plus l'origin | côté serveur HS, à re-tester avant `IGNORE` |

Le lot `61a4552` s'intitulait « supprimer 5 scrapers 404 » : **4 des 5 domaines
servaient normalement** et le cinquième répondait en HTTP. Le motif « 404 » du
commit n'était pas une propriété du site, c'était l'échec de la sonde.

Le lot `227059e` (« supprimer 5 scrapers Cloudflare ») supprime `nhentai.xxx`,
`hentaiscanreader` et `rimuscan` alors que ces trois là répondent en 200 avec un
catalogue complet. Le même commit introduit WARP dans le workflow : **la sonde WARP
qui justifierait ces suppressions n'a jamais été écrite dans le message**, et sans
elle un 403 de runner ne prouve rien.

Restent à trancher, et **ceci n'est pas du ressort d'un registre** :

- `astral-manga.fr` : 403 de défi Cloudflare. Il faut une sonde **via WARP** pour
  savoir si le site s'ouvre ailleurs. À ce stade : `UNKNOWN`.
- `phenix-scans.co` : un 523 est un côté serveur cassé, ce qui est réversible.
  Un seul point de mesure ne suffit pas pour `IGNORE`.
- `warforrayuba` : sa `baseUrl` historique pointait vers une page GitHub
  (`xrabohrok.github.io/WarMap`), pas vers le site. Le commit a supprimé le port
  pour « album imgur disparu », sans preuve que le site lui-même ait disparu.

### Deux sources retirées du registre après vérification directe

Elles figuraient ici, aucune des deux n'y avait sa place. La preuve est conservée
parce que ce sont les deux diagnostics les plus trompeurs qu'on ait faits.

**`all/baobua` (`baobua.net`) — retirée : le site est `BUILD`, pas mort.** Son 451/1026
était transitoire. Les quatre endpoints du Kotlin répondent aujourd'hui en `-4`, sans WARP :

| Endpoint upstream | Sonde | Résultat |
|---|---|---|
| `getPopularManga` → `/?page=N` | `?page=1` puis `?page=2` | 200, 76 471 o / 70 160 o ; 24 fiches `/spot/…` par page, **0 en commun** entre les deux pages ; `.thcovering-video` et `a.denomination` présents (28) |
| `getSearchMangaList` → `/search?q=…&page=…` | `q=bikini` | 200, 72 211 o, **différent** de l'index ; le site accepte vraiment la recherche |
| `fetchMangaUpdate` → `/spot/<slug>.html` | 1 fiche | 200 ; `div.contentme` présent, `IMAGE_SELECTOR` = 11 images, `"datePublished":"2026-10-01"` → site activement mis à jour |
| `getPageList` | image normalisée hors `i*.wp.com` | 200, `image/jpeg`, 69 099 o |

Porté dans #388 : c'est un site de **galeries**, pas un manga chapitré — un seul
chapitre, les pages étant paginées par offsets cumulés suivant le lien `Next`. Le port
est donc un `BUILD` avec un chapitre unique, et le titre vient de `og:title` (`h2`
vise un slot publicitaire). À noter pour la relecture : le `451` initial était bien
transitoire, quatre galeries sont revenues en `206` sans WARP.

**`all/hentailoop` (`hentailoop.com`) — retirée : `BLOCKED`, donc verdict inconnu.**
Ni morte ni portsable depuis ici. La séquence mesurée :

| Sonde | Résultat |
|---|---|
| Résolution système (`getent`) | `::1` — loopback, sans entrée dans `/etc/hosts` |
| Résolveurs publics (1.1.1.1, 8.8.8.8) | `188.114.96.3`, `188.114.97.3`, `2a06:98c1:3120::3` (Cloudflare) |
| `--resolve` vers l'IP réelle, `-4` | **403**, 4 549 o, titre `Attention Required! \| Cloudflare` |

Le domaine existe et pointe sur Cloudflare : le `000` venait du résolveur du sandbox, et
le `403` est un bannissement de ce runner. Aucun manga n'est lisible depuis cette IP, mais
c'est une propriété de **notre position réseau**, pas du site — un `IGNORE` serait donc
faux au sens de ce registre. Elle reste candidate `BUILD` dès qu'une route lisible existe
(WARP), et ne doit réapparaître ici que sur une preuve propriété au site.

**Suivi 2026-10-03 :** la route lisible existe désormais — `https://hentailoop.com`
répond 200 (86 505 o, vrai catalogue) à la fois via WARP et en `--noproxy '*'`. Le
catalogue, la recherche AJAX (`nativeSearch`), la fiche, la page `/read/` et la sonde
`addview` ont été transcrits dans `definitions/webtoons/all/hentailoop.ts` (verdict
`BUILD`, issue #391). `hentailoop` n'a plus sa place dans la catégorie « bloqué ».

**`all/niadd` (`<sub>.niadd.com`) — retirée le 2026-10-03 : condition de revivification
levée.** Les huit sous-domaines répondent 200 avec un vrai catalogue (~77–86 ko), et
`https://www.niadd.com/list/Hot-Manga.html` renvoie 200, 289 713 o avec un vrai HTML de
liste. La ligne `IGNORE` est supprimée du tableau ; la source redevient candidate
`NOUVEAU`/`BUILD`.

## Resonde non-datacenter du 2026-10-04 : `en/comix` et `en/xomanga`

Ces deux sources étaient `UNKNOWN` parce que le runner de CI est une IP datacenter et
que les deux domaines renvoyaient un `403` Cloudflare. La règle du registre refuse
toujours d'écrire un `IGNORE` sur cette seule preuve : il fallait une contre-sonde hors
datacenter. Elle a été faite depuis une IP résidentielle, ce qui change la donne.

**Position réseau de la sonde.** `92.128.4.120` en IPv4 et
`2a01:cb05:9323:4000:…` en IPv6, toutes deux `AS3215 Orange S.A.` (FAI résidentiel
français), donc effectivement une position non-datacenter. Témoin sur la même machine :
`https://example.com` répond `200`, le réseau n'est donc pas en cause.

**`en/comix` (`comix.to`) — `IGNORE` : challenge JavaScript sur toutes les routes.**

| Route | HTTP | Corps | Titre |
|---|---|---|---|
| `/` | 403 | 5 591 o | `Just a moment...` |
| `/api` | 403 | 5 344 o | `Just a moment...` |
| `/api/manga/list` | 403 | 5 611 o | `Just a moment...` |
| `/api/v1/manga` | 403 | 5 605 o | `Just a moment...` |
| `/index.json` | 403 | 5 599 o | `Just a moment...` |
| `/robots.txt` | 403 | 5 599 o | `Just a moment...` |

Résultat identique en IPv4 forcée et en IPv6. Le mur ne dépend donc pas de notre
position réseau : c'est un challenge Cloudflare servi à tout client qui n'exécute pas de
JavaScript, et il ne laisse passer aucune voie JSON. L'upstream le confirme en
utilisant `runWebView` pour la navigation, ce que notre moteur Cheerio ne peut pas faire.
Rentre donc dans « Moteur de navigateur requis », comme `japscan` et `mangaplaza`.

Condition de revivification : une route servant du contenu ou du JSON **sans** challenge
Cloudflare.

**`en/xomanga` (`xomanga.com`) — `BLOCKED`, donc verdict inconnu : le site est
excellent, c'est notre position réseau qui bloque.**

| Route | HTTP | Corps | Constat |
|---|---|---|---|
| `/` | 200 | 159 885 o | `XOmanga — Read Manga Online`, vrai catalogue |
| `/api/manga/list` | 200 | 9 170 o | JSON réel : `{"manga":[{"id":"b53b972d-…","slug":"shu-san-wa-furimukanai",…}]}` |
| `/index.json` | 404 | 33 204 o | le chemin utilisé par l'upstream n'existe plus, l'API a été déplacée |

Le site est donc transposable tel quel : l'upstream ne fait que du JSON, et l'API répond
sans challenge ni authentification. Ce qui l'a fait passer pour morte en CI est
exclusivement le `403` Cloudflare appliqué aux plages GitHub Actions, WARP compris.

À ne pas confondre avec un `IGNORE` : le registre classe `BLOCKED` une source vivante
que seule notre position réseau empêche de lire (cf. `hentailoop` avant sa
resonde). Elle redevient candidate `BUILD` le jour où le egress du scraping webtoon
n'est plus une IP datacenter, pas le jour où le site change.

Condition de revivification : un egress non-datacenter pour le scraping webtoon, ou une
levée du blocage Cloudflare sur les plages GitHub Actions.


## Critere de portabilité : ce qu'on ingère n'est pas ce qu'on lit

Cette section remplace deux verdicts antérieurs, tous deux faux, et pour la même
raison : on avait juge la source sur ce que le *lecteur* du site sait faire, au lieu
de regarder ce que la *pipeline* ingère.

**Ce que la pipeline ingère.** Pour `type === 'webtoon'`, le worker envoie une seule
URL par source : `result.rootUrl` (`scrapers/webtoons/src/worker.ts:84`), c'est-a-dire
**l'URL de la serie**. Le backend la stocke telle quelle dans `liens.url` et l'utilisateur
est redirige dessus. Les images des chapitres ne sont jamais utilisées dans ce chemin.
Verifie en base : 285 jobs `webtoon` reussis, **0 job `comic`** -- le chemin qui ingère
un lien par chapitre n'est pas utilise.

**Le critère, donc : une source est portable si elle livre un catalogue lisible et une
URL de fiche lisible, en HTTP simple.** Un WebView, une API signée, un descramblage
d'images ou un defi Cloudflare sur les *pages* ne bloquent rien, tant que ces deux la
sont accessibles.

Ce critère a ete applique à la baisse sur `comix`, `aniverse` et `cartoonporn`, qui avaient
ete écartées pour des raisons qui ne concernaient que les pages.

### `en/comix` (`comix.to`) — candidat `BUILD`

Le premier verdict le classait `IGNORE` en s'appuyant sur un `Cipher` upstream
(`Comix.kt` : WebView, sboxes, signature des requetes). **Ce raisonnement est hors sujet
ici** : tout cela ne sert qu'a lire les images des chapitres.

Ce qui compte, et qui est vérifié :

| Besoin | Etat |
|---|---|
| catalogue | `script#initial-data` dans le HTML, 270 entrées `/title/…`, 130 slugs distincts |
| URL de fiche | `https://comix.to/title/<slug>` -> **200**, 30 ko, titre + synopsis + genres |
| couvertures | JPEG directs sur `static.comix.to`, **vérifié** (200, 37 ko, 280x420) |

Ce qui manque est reel mais sans effet ici : les pages de chapitre ne sont pas dans le
HTML (`/title/<slug>/<id>-chapter-N` -> 200 avec 3,7 ko de metadonnées et zero image) et
passent par une requete signée. Consequence pour un futur pipeline `comic` : le port
devrait etre marque `comic-unsupported`, pas `webtoon-unsupported`.

### `fr/aniverse` (`aniverse.fr`) — candidat `BUILD`

Verdict refait apres une première erreur de ma part : j'avais conclu non portable en
cherchant le format d'URL dans `/home` et dans les premiers chunks JS, sans trouver de
motif. Le format existe, il était dans le chunk 24 : `/manga/<slug>`.

| Besoin | Etat |
|---|---|
| catalogue | `/manga` -> **200**, 571 ko, **41 slugs** dans le payload RSC |
| URL de fiche | `https://aniverse.fr/manga/blue-lock` -> **200**, titre « Blue Lock Scan VF – Aniverse FR », genres et episodes presents |

Preuve du premier verdict faux : sur `/home` le payload contient 28 slugs mais aucun lien
de fiche ; sur `/manga` il contient a la fois les slugs et les routes `/manga/<slug>`. La
lecon est qu'il faut balayer **tous** les chunks JS : les routes sont formées par une
concatenation (`"/" + segment`) que le HTML seul ne montre pas.

### `en/cartoonporn` (`cartoonporn.to`) — candidat `BUILD`

| Besoin | Etat |
|---|---|
| catalogue | `/porncomic/` -> **200**, 71 ko de texte, **90 liens** `/porncomic/<slug>` |
| URL de fiche | `/porncomic/<slug>/` -> **200**, titre « All in the Name of Eros... », 6 570 car |

`/wp-json` repond **401**, donc l'API WordPress est verrouillée : le port doit passer par
le HTML. La racine `/` ne sert que 7 liens de navigation, c'est `/porncomic/` qui porte le
catalogue.

### `fr/scanmanga` (`m.scan-manga.com`) — candidat `BUILD`

`m.scan-manga.com` fait une `302` vers `www.scan-manga.com`. Les liens sont en URL absolue
`https://www.scan-manga.com/<id>/<slug>.html`, et la fiche `/12915/Level-Up-With-Skills.html`
repond **200** avec un titre et 27 836 caractères de texte.

### `en/kitsunedawn` (`kitsunedawn.com`) — candidat `BUILD`, avec une reserve

| Besoin | Etat |
|---|---|
| catalogue | `/latest` -> **200**, **95 liens** `/read/<uuid>` |
| URL de fiche | `/read/<uuid>` -> **200**, titre « My Beautiful Childhood Friend... » |

La racine affiche « No series found » alors que `/latest` en sert 95 : un port qui vise `/`
paraîtra vide alors que le site est plein. `/read/<uuid>` est bien la fiche d'une serie
(son titre mentionne « Share Chapter 5 »), et non un chapitre isolé.

### `en/templescan` (`templetoons.com`) : BLOCKED, le site a mis un challenge

Verdict du **2026-10-11**, de nature un peu différente des quatre Cloudflare du cycle du
2026-10-06 : ceux-là répondaient `403`, celui-ci répond `307` et **redirige vers une page de
défi**.

Sonde : `https://templetoons.com` -> `307` vers `/challenge?redirect=%2F`, puis `200` avec
**14 771 o** et un marqueur de challenge dans le corps. Aucun catalogue n'est rendu.

Conséquence pour le port : `getPopular` échoue désormais sur ce qui était un site
fonctionnel. C'est une **régression**, pas une source neuve — et l'issue #443 la liste
comme `CRITIQUE` parce que l'upstream a ajouté un `ChallengeInterceptor.kt`, ce qui
confirme que le site a changé de comportement et que l'extension officielle a suivi.

Selon le critère de portabilité ci-dessus, le défi ne bloquerait rien **sur les pages** —
or il est sur la racine, donc le catalogue lui-même est hors d'atteignable et aucun
`rootUrl` ne peut être produit. Même situation que les quatre Cloudflare, donc même
verdict.

| Extension | Domaine upstream | Verdict | Preuve | Condition de revivification |
|---|---|---|---|---|
| `en/templescan` | `templetoons.com` | BLOCKED | `307` -> `/challenge?redirect=%2F`, puis `200` / **14 771 o** avec marqueur de challenge ; aucun catalogue rendu | La racine rend un catalogue lisible en HTTP simple (défi retiré, ou passage en Defensive mode) |

### `all/sirenscans` (`sirenscans.org`) : candidat `BUILD`

Verdict du **2026-10-12**, suite au cycle du 12/10. Cette source est **`NOUVEAU`
upstream** et ne figurait pas encore au registre, mais l'unique signal disponible était
la colonne « Cloudflare » du moniteur. Ce signal est **faux dans les deux sens** : voir le
piege 6 ci-dessous.

Sondes en HTTP simple (UA navigateur, `-L`), catalogue puis fiche :

| Source | Catalogue | Fiche | Verdict |
|---|---|---|---|
| `all/sirenscans` | `https://sirenscans.org/recently-updated` → **200**, 250 732 o, **78 series** en liens relatifs | 57 liens de lecture sur la home | candidat `BUILD` |

`sirenscans` sert du HTML statique, sans framework detectable.

Le second candidat de cette sonde, `en/toonz`, a ete **rejuge `BLOCKED` au cycle du
2026-10-23** (defi Cloudflare sur le catalogue, voir la section suivante).

Ce qui manque encore pour un port, et qui sera le travail du cycle suivant : la liste
paginee (`hasNextPage`), les chapitres et les images n'ont pas ete verifies. C'est un
candidat, pas un port.

### `all/comicklive` et `all/dbnewhope` : a re-sonder

| Source | Sonde | Lecture |
|---|---|---|
| `all/comicklive` | `https://comick.live` → **200**, 89 878 o, titre `ComicK - Comick.io` | Rend un titre et une page de 89 ko, mais **0 lien manga** et `/comics` → **404**. La racine sert une coquille ; le catalogue n'est pas localise. |
| `all/dbnewhope` | `https://dbnewhope.com` → **200**, 16 569 o, titre `DB New Hope - Free Fan Manga` | `/comics` → **404** avec 196 o. Catalogue non localise. |

Ni l'un ni l'autre n'est `BLOCKED` : ni le moniteur ni une sonde unique ne permettent de
conclure. Les deux restent **inconnus** et doivent etre re-sondes a la prochaine
occasione, en cherchant le vrai chemin de catalogue plutot qu'en supposant `/comics`.

### `en/templescan` : le `BLOCKED` tient, et l'observation le confirme

Le cycle du 12/10 signale une modification critique de `TempleScan.kt` (+2 lignes :
« Cloudflare blocks requests that send Origin »). C'est une piste serieuse, et elle a ete
testee au lieu d'etre reprise telle quelle.

Test du retrait de l'en-tete `Origin` (le fix upstream) : **aucun changement**, la reponse
reste la page de defi de 14 771 o. Fiche `/comic/<slug>` : **200 mais 14 771 o exactement**,
soit la taille de la page de defi — donc elle aussi bloquee.

Contre-test avec un vrai navigateur (profil vierge, `chrome-clean`) : le `challenge-platform`
repond **200** et le site charge avec **53 images** et **82 fiches `/comic/<slug>`**. Donc le
defi est surmontable par un navigateur execute du JavaScript, et par rien d'autre.

C'est exactement la definition de `BLOCKED` dans ce fichier : le site est vivant et le
navigateur y entre, mais le catalogue et la fiche ne sont pas atteignables en HTTP simple,
donc aucun `rootUrl` ne peut etre produit par notre pipeline. Le correctif de 2 lignes
d'upstream ne change rien a ce constat pour nous.

### `all/komga` : `http://127.0.0.1:25600`, hors perimetre

Le moniteur le liste comme `NOUVEAU`, mais l'URL upstream est un **serveur local**. Ce n'est
pas un site web : c'est un serveur de bibliotheque que l'utilisateur fait tourner chez lui.
Aucun port n'a de sens ici, et aucune sonde depuis l'Internet ne peut dire quoi que ce soit.
Deja au registre.

### Les 3 autres `CRITIQUE` : aucun rapport avec la portabilite

`all/kodokustudio`, `all/novelcool` et `en/comix` sont des **refactorisations internes
upstream** (changement de classe de base, nouvelle methode `getMangaByUrl`, reecriture du
chiffrement). Aucun ne modifie ce qu'un `webtoon` ingere :

- `en/comix` : le port existe deja (#446) et n'ingere que `rootUrl`. La suppression de
  `Cipher.kt` concerne l'API de recherche signee du lecteur, pas le catalogue.
- `all/novelcool` : le nouveau `getMangaByUrl` verifie `url.host` et lit `pathSegments`.
  C'est une source **novel**, pas un port `webtoon` de ce registre.
- `all/kodokustudio` : passage de `Madara()` a `KeiSource()`. Pas d'impact catalogue.

### `en/coffeemangaunoriginal` (`coffeemanga.net`) : candidat `BUILD`

Le nom upstream est `coffeemangaunoriginal`, mais le domaine qui repond est
`coffeemanga.net`. A ne pas confondre avec l'entree historique `en/coffeemanga`
(voir plus haut), qui porte sur `coffeemanga.com` : ce domaine fait `301` vers
`coffeemanga.moe`, lequel ne rend **rien** en HTTP simple (114 o). Ce sont deux
sites distincts, et l'ancien verdict `IGNORE` ne s'applique qu'a `.com`/`.moe`.

Sonde du **2026-10-16**, en HTTP simple (UA navigateur, `-L`). WordPress classique,
pas de SPA : le catalogue et les fiches sont dans le HTML servi.

| | Resultat |
|---|---|
| catalogue | `/manga/?m_orderby=latest` -> **200**, 79 liens de serie distincts |
| fiche | `/manga/dungeon-crawler-carl/` -> **200**, titre `Dungeon Crawler Carl`, 3 liens de chapitre |
| tri | `m_orderby` accepte `latest`, `views`, `new-manga`, `alphabet`, `rating` |

Candidat `BUILD`, pas port : il reste a confirmer le nombre de pages du catalogue et
la lecture des chapitres.

**Mis a jour le 2026-10-26** : le site `coffeemanga.net` n'est plus le WordPress decrit
ci-dessus, mais une application Inertia (`<script data-page="app" type="application/json">`).
L'ancien domaine `coffeemangaunoriginal.com` est en `NXDOMAIN`. Le port
`en/coffeemangaunoriginal.ts` (PR #552) lit les props `Catalog/Home`, `Catalog/Series`,
`Catalog/Search` et `Reader/Chapter` ; gate live PASS sur le nouveau domaine.

### `all/mangamillion` (`mangamillion.shueisha.co.jp`) : pas un port simple

La sonde HTTP simple renvoie 200 et 88 ko, mais le HTML ne contient que **2 liens
internes** : le site est entierement rendu cote client.

Le trafic reel montre `api.mangamillion.shueisha.co.jp` avec deux obstacles :

1. **`content-type: application/protobuf`** — les reponses sont du Protocol
   Buffers, pas du JSON. Il faudrait un decodage protobuf.
2. **`access-token` obligatoire** — l'API `/api/home` repond **422** sans le
   jeton, et le jeton est fourni par un appel de session (`/api/register`).

Ce n'est donc pas un port `webtoon` de notre type : la racine n'est pas lisible et
l'API n'est ni en JSON ni accessible sans jeton. Le reconstruire demanderait de
lire le format protobuf et de reproduire la session — un travail sans rapport avec
un port de site, et fragile a chaque changement d'API.

### `en/readcomicsonline` (`readcomicsonline.ru`) : `BLOCKED`

`/` repond **403** en 5 548 o. Verdict `BLOCKED` : le catalogue n'est pas
atteignable en HTTP simple, donc aucun `rootUrl` n'est produit.

### Rappel sur les 2 ports repris ce cycle

`omegascans` et `philiascans` avaient ete livres puis refuses a juste titre : ils
scrapaient le HTML et **fabriquaient les titres a partir des slugs**. Re-portes
contre leur API JSON (`api.omegascans.org/query` et `philiascans.org/api/manga`),
les titres sont desormais les vrais, la pagination suit `last_page`/`totalPages`, et
la recherche repond sur des titres reels.

### Ce qui reste reellement bloqué

Les quatre sources du cycle du 2026-10-06 (`theblank`, `astralmanga`, `epsilonscan`,
`softepsilonscan`) restent `BLOCKED`, et cette fois pour la bonne raison : leur
*catalogue* lui-même est derrière le challenge. Sonde du 2026-10-09 sur la racine des
trois domaines distincts : `403`, ~5,4 ko, `<title>Just a moment...</title>`,
`cf-mitigated: challenge`. Aucun `rootUrl` n'est atteignable, donc aucune URL de fiche
non plus. C'est le seul cas ou le désobfuscateur du lecteur est un vrai bloqué.

## Resonde du 2026-10-07 : `fr/xomanga` revivifie, `en/comix` a ete corrige

Sonde IPv4 (`curl -4`) le 2026-10-07. La première version de cette section concluait que les
deux domaines n'etaient plus bloques, sur le raisonnement « HTTP 200 donc le blocage est
leve ». `xomanga` : confirme, et meme au-dela, puisque le catalogue est lisible depuis la CI
(voir la section du 2026-10-09). `comix` : le raisonnement etait bon, la conclusion non —
voir le critère de portabilite plus haut.

### `en/kaliscancom` : supprimé upstream, domaine introuvable — port retiré

Issue #460 (`:wastebasket: SUPPRIME`). Sondé le **2026-10-14**, en IPv4 (`curl -4`),
via WARP puis `--noproxy '*'` : les **quatre miroirs** de l'extension —
`kaliscan.com`, `kaliscan.me`, `kaliscan.io`, `mgjinx.com` — sont tous en
**NXDOMAIN** sur les deux routes. Aucune occurrence de `REMOVE` n'exige pas
mieux : un domaine qui ne résout plus, sur WARP et sans tunnel, est mort en tant
que site. Le port `definitions/webtoons/en/kaliscancom.ts` a été retiré de
l'arbre de travail ; la suppression sera committée via la PR du `REGISTRY_RECHECK`
ci-dessous, comme n'importe quel autre verdict.

| Extension | Domaine upstream | Verdict | Preuve | Condition de revivification |
|---|---|---|---|---|
| `en/kaliscancom` | `kaliscan.com` + `kaliscan.me` + `kaliscan.io` + `mgjinx.com` | RETIRÉ | `NXDOMAIN` sur les quatre miroirs, via WARP et `--noproxy '*'` (2026-10-14) | Un miroir redevient résolvable et ressert un catalogue lisible |

## Six pièges de diagnostic à connaître

Ces six cas ont déjà produit un verdict faux. Ils sont notés pour que la relecture ne
refasse pas l'erreur.

1. **`curl` sans `-4` ment.** Plusieurs domaines ci-dessus n'ont pas de route IPv6 et
   répondent `000` par défaut, alors qu'ils répondent 200 en IPv4. Toujours sonder en `-4`
   avant de conclure « mort ».
2. **L'upstream n'est pas toujours à jour sur son propre domaine.** Les `baseUrl` réels
   sont dans `src/<lang>/<ext>/build.gradle.kts`, pas dans le `.kt` principal. `japscan`
   est `www.japscan.foo` (et non `.com`), `baobua` est `baobua.net` (et non `.com`).
   Sonder le mauvais domaine fait conclure à tort que le site est mort.
3. **`error code: 1026` est un bannissement d'ASN, pas une mort de site.** Cloudflare le
   renvoie aux runners en datacenter. Preuve : `baobua.net` (172.67.206.118) et
   `kiutaku.com` (172.67.216.228) renvoient **le même** 451 / 17 octets / 1026, alors que
   `kiutaku` est un site vivant déjà porté dans ce dépôt. Un 451 ne prouve donc **rien** sur
   l'état du site tant qu'il n'a pas été revalidé via WARP. C'est la règle la plus coûteuse
   à réapprendre, d'où sa place ici.
4. **Un `200` avec un bon titre peut être une page vide — mais il ne prouve pas non plus
   que le site est mort.** `comix.to` répond `200`, pèse 400 ko et s'intitule
   « Comix - Read Comics online for free », alors que sa racine ne rend que 35 caractères
   de texte visible : le catalogue est monté en JavaScript et ne se trouve que dans
   `script#initial-data`. Deux erreurs symétriques à éviter donc : conclure « mort » parce
   que le HTML est vide, et conclure « vide » parce que le HTML est vide — ici les données
   sont toutes là, il faut juste lire le bon endroit. Corollaire du même genre : l'absence
   de marqueur de challenge ne prouve pas l'absence de blocage, car
   `/cdn-cgi/challenge-platform/scripts/jsd/main.js` (Cloudflare Bot Management) est
   injecté sur tout site derrière Cloudflare et n'a rien à voir avec un défi.
5. **Juger une source sur le lecteur du site plutôt que sur ce qu'on ingère.** C'est
   l'erreur qui a fait classer `comix` et `aniverse` non portables : on a regardé ce que le
   lecteur sait faire (WebView, chiffrement, signature) alors que la pipeline n'ingère que
   l'URL de la série. Voir « Critère de portabilité » plus haut.

Corollaire : un `ETIMEDOUT` vers une IP Cloudflare, ou un `ECONNRESET` en rafale sur
plusieurs sites, vient généralement du runner lui-même (réseau restreint, ou throttling
Cloudflare déclenché par le volume du `batch_test`). Ce n'est pas un signal de site mort,
et `batch_test` ne doit pas s'en servir pour conclure quoi que ce soit.

6. **`challenge-platform` n'est pas la preuve d'un blocage.** Cloudflare injecte ce
   script sur **toutes** les pages de ses sites, y compris celles qui rendent leur contenu
   normalement. Le chercher dans le HTML donne un faux positif quasi systematique : au
   cycle du 12/10, `lunatoons` (113 liens) et `onemanga.info` (14 liens) sortaient « défi »
   alors qu'ils servent un catalogue complet.

   Le seul test qui ne ment pas, c'est de comparer avec la taille exacte de la page de
   défi : `templetoons` renvoie **14 771 o** à la fois sur `/` et sur une fiche `/comic/…`,
   donc aucune des deux n'est lisible. Un vrai contenu a une taille et des liens
   différents. De même, une réponse `403` isolée sur un site qui répond `200` ailleurs ne
   prouve rien.

   Corollaire : un vrai navigateur peut traverser un défi que HTTP simple ne peut pas
   franchir. C'est précisément ce qui distingue « le site est vivant » de « le catalogue
   est atteignable », et c'est le second qui compte pour un port.

Sondé le **2026-10-18** (issue #486), en IPv4 (`curl -4`), via WARP puis `--noproxy '*'` :
défi Cloudflare `cf-mitigated: challenge` identique sur les deux routes — aucun catalogue
n'est atteignable en HTTP simple, et l'anti-bot survit à une transcription fidèle de
l'intercepteur upstream. Verdict `UNKNOWN` (pas `IGNORE`) : un blocage sur les deux routes
ne distingue pas un site mort d'une IP de runner bannie.

| Extension | Domaine upstream | Verdict | Preuve | Condition de revivification |
|---|---|---|---|---|
| `en/allporncomic` | `allporncomic.com` | UNKNOWN | `403` + **5 311 o**, `<title>Just a moment...</title>`, `server: cloudflare` et **`cf-mitigated: challenge`**, identique via WARP et sans tunnel | Un `GET` sans navigateur rend un catalogue lisible |
| `all/manhwadashraw` | `manhwa-raw.com` | UNKNOWN | `403` + **5 202 o**, `<title>Just a moment...</title>`, `server: cloudflare` et **`cf-mitigated: challenge`**, identique via WARP et sans tunnel | idem |
| `en/batcave` | `batcave.biz` | UNKNOWN | `403` + **5 284 o**, `<title>Just a moment...</title>`, `server: cloudflare` et **`cf-mitigated: challenge`**, identique via WARP et sans tunnel | idem |
| `en/killsixbilliondemons` | `killsixbilliondemons.com` | BUILD | Le 2026-10-26 (issue #529), `GET /` en HTTP simple rend **200** et **46 428 o** avec le contenu de la série : l'interstitiel LiteSpeed « One moment, please... » n'apparaît plus. Le port `en/killsixbilliondemons.ts` a été validé en direct (popular/search/chapitres/pages) sur l'archive WordPress paginée et `#comic img` | Le port cesse de parser l'archive ou le site repasse derrière un interstitiel |

Changements du **2026-10-26** (issue #529) : `all/voyceme` reste `IGNORE` pour `voyceme.com` (domaine en vente) ; l'extension `en/voyceme`, distincte, n'a pas encore de port `.ts`. `en/killsixbilliondemons` passe de l'interstitiel LiteSpeed à `BUILD`, le port `en/killsixbilliondemons.ts` (PR #542) ayant été validé en direct.

Sondé le **2026-10-19** (issue #500), en IPv4 (`curl -4`), via WARP puis `--noproxy '*'` :

| Extension | Domaine upstream | Verdict | Preuve | Condition de revivification |
|---|---|---|---|---|
| `en/comix` | `comix.to` | BLOCKED | `403` + **5 281 o**, `<title>Just a moment...</title>`, `server: cloudflare` et **`cf-mitigated: challenge`**, identique via WARP et sans tunnel. L'upstream a migré vers `runInWebView` pour la même raison | Un `GET` sans navigateur rend un catalogue lisible |
| `all/lunaranime` | `lunarx.to` | UNKNOWN | `403` + **5 282 o**, `<title>Just a moment...</title>`, `server: cloudflare` et **`cf-mitigated: challenge`**, identique via WARP et sans tunnel. Rejugé le **2026-10-23** : candidat `BUILD` via l'API `api.lunarx.to` (voir ci-dessous) | Un `GET` sans navigateur rend un catalogue lisible |
| `all/deviantart` | `www.deviantart.com` | IGNORE | Extension upstream de type galerie (`gallery:<user>/<folder>`), pas de catalogue popular/search standard ; `getPopularManga` upstream lève `UnsupportedOperationException`. Aucun catalogue générique ingérable par le pipeline webtoon | L'extension upstream expose un catalogue popular/search générique |

### Cycle du 2026-10-23 : `en/toonz` rejugé `BLOCKED`, `en/mangacloud` confirmé `BLOCKED`, `all/lunaranime` → candidat `BUILD`, re-sonde `en/mangabay`

Sondes du **2026-10-23** en IPv4 (`curl -4 --noproxy '*'`), UA navigateur Chrome 129
(appareil : WARP désactivé).

| Extension | Domaine upstream | Verdict | Preuve | Condition de revivification |
|---|---|---|---|---|
| `en/toonz` | `toonz.to` | BLOCKED | `/manga/most-popular` → `403` + **5 677 o**, `<title>Just a moment...</title>`, `server: cloudflare` et **`cf-mitigated: challenge`** ; la home `/` répond `200` (190 903 o) tantôt, tantôt le défi — blocage instable, en amont d'un catalogue `/manga/...` servi parfois. Le jour du cycle upstream (2026-10-22), le moniteur a aussi reçu `403` sur `/` et `/manga/most-popular` | Un `GET` sans navigateur rend le catalogue `/manga/most-popular` lisible |
| `en/mangacloud` | `mangacloud.org` (API `api.mangacloud.org`) | BLOCKED | `baseUrl` upstream `https://mangacloud.org` → **200** ; catalogue en **409** sur les deux routes du port (`GET https://api.mangacloud.org/comic-popular-view/today` et `POST https://api.mangacloud.org/comic/library`, corps `{"error":"Conflict"}`), et l'upstream (`MangaCloud.kt`) exige un handshake `POST $API_URL/auth/handshake` avec un token Turnstile (`getTurnstileToken`, siteKey `0x4AAAAAADLVIGf7KBRQctG1`, action `guard`) — non reproductible en HTTP simple. Note : `en/mangacloud.ts` supprimé ce cycle | Un token Turnstile calibré sans solveur navigateur, ou un endpoint catalogue rendu en HTTP simple |
| `all/lunaranime` | `lunarx.to` + `api.lunarx.to` | **candidat BUILD** (rejugé, `UNKNOWN` annulé) | L'extension upstream s'appelle **Lunar Manga** et son catalogue est une API ouverte : `GET https://api.lunarx.to/api/manga/search?page=1&limit=3` → **200**, JSON, `total: 6699`, champs `slug`/`title` ; `GET https://api.lunarx.to/api/manga/recent?page=1&limit=3` → **200**, `our_mangas`. Fiche : `https://lunarx.to/manga/<slug>` (ex. `https://lunarx.to/manga/the-cliff` → 200 via fetch externe, titre « The Cliff »). La home et la fiche restent `403` Cloudflare depuis le runner, mais la pipeline n'ingère que `rootUrl` et le catalogue est joignable en HTTP simple. Le lecteur exige Turnstile + DPoP + AES (`LunarSerenity.kt`, `LunarDecryptor.kt`), sans impact sur le catalogue | n/a — à construire dans un prochain cycle, ne pas construire ce passage |
| `en/mangabay` | `manga-bay.biz` | IGNORE | **Re-sonde du 2026-10-23 maintenue** : `302` → `/_c?t=<token>&u=https%3A%2F%2Fmanga-bay.biz%2F`, cible **404** ; l'upstream re-liste toujours `src/en/mangabay` (DleGuardResolver.kt inchangé). Verdict ignoré maintenu | idem |

## Cycle du 2026-10-26 (issue #544) : ports live, deltas non applicables, blocages

Sondes du **2026-10-26** en IPv4 (`curl -4 -L`), UA navigateur.

### Ports valides en direct

| Extension | Domaine | Verdict | Preuve |
|---|---|---|---|
| `en/zazamanga` | `www.zazamanga.com` | PORTE (#550) | `GET /manga/?m_orderby=views` -> **200**, 195 198 o, cartes `div.page-item-detail` ; fiche et chapitre lisibles ; gate PASS (popular 24, latest 13, search 6, chapters 2140, pages 9) |
| `en/voyceme` | `www.voyce.me` | PORTE (#551) | `POST https://hasura.voyce.me/v1/graphql` -> **200** ; popular/latest 20, search 2, chapters 135, pages 6 ; images `chapter_panels/*.jpeg` servies en **200** par le CDN statique |
| `en/coffeemangaunoriginal` | `coffeemanga.net` | PORTE (#552) | `GET /` -> **200**, 322 914 o, app Inertia ; gate PASS (popular 12, latest 24, search 1, chapters 20, pages 1) ; ancien domaine `.com` en `NXDOMAIN` |

### Sources inaccessibles en HTTP simple : aucun `rootUrl` produit

| Extension | Domaine upstream | Verdict | Preuve | Condition de revivification |
|---|---|---|---|---|
| `fr/toonfr` | `toonfr.com` | UNKNOWN | `403` + **5 433 o**, `<title>Just a moment...</title>` (Cloudflare) | Un `GET` sans navigateur rend le catalogue |
| `all/mangadotnet` | `mangadot.net` | UNKNOWN | `403` + **5 435 o**, challenge Cloudflare | idem |
| `en/hentairead` | `hentairead.com` | UNKNOWN | `403` + **5 458 o**, challenge Cloudflare | idem |
| `en/comichubfree` | `comichubfree.com` | UNKNOWN | `/popular-comic` -> `403` + **5 520 o**, challenge Cloudflare ; gate `HOLD` (`probe: BLOCKED, HTTP 403, corps 5545 o`). Le correctif upstream des selecteurs `Author:` / `Genres:` a ete merge (#553) sans validation live | Un `GET` sans navigateur rend popular/latest/search |

`all/nhentaicom` n'est pas dans le tableau ci-dessus : la sonde TLS echoue avant
toute reponse HTTP (`curl: (35) TLS connect error: ... wrong version number`), donc le
gate ne peut pas conclure. Verdict `UNKNOWN` maintenu ; condition de revivification :
un `GET` HTTP simple repond a nouveau.

### Deltas upstream non applicables au port `.ts`

- `all/mangafire` : ajout de `languages[]=<langCode>` cote upstream ; notre source est un agregateur unique `lang='all'`, aucun filtre de langue a ajouter.
- `all/schalenetwork` : retrait du mapping de langue `ja` ; notre port n'a pas de mapping de langue.
- `en/comix` : changement WebView/readyState/tags API, cote lecteur ; le port n'ingere que `rootUrl`.
- `en/templescan` : changement de headers d'images ; notre `getPageList` ne fait que retourner des URLs, sans requete image.
- `en/webnex` : passage du lecteur en WebView ; `getPageList` n'est pas utilise par la pipeline.
- `all/mangatoon` / `all/namicomi` : `versionCode` et listes de langues uniquement ; aucun changement `.ts`.

## Maintenance

Ce registre est **modifié uniquement par les agents, et uniquement via PR** — jamais en
écriture directe sur `main`. Le monitor keiyoushi relit ce fichier à chaque passage
(voir `.github/prompts/keiyoushi-analysis.md`, Phase 0) et n'ajoute une entrée qu'après
avoir constaté le motif de blocage de son propre côté.

Le `batch_test.ts` distingue désormais `EMPTY_DEAD` (site mort : le port est inutile)
de `EMPTY` (site vivant qui ne matche plus : le port est à corriger). Un site listé ici
peut donc être diagnostiqué automatiquement, sans le re-diagnostiquer à la main.