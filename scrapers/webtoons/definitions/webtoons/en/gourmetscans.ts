import { createDecipheriv, createHash } from 'node:crypto';
import { MadaraScraper } from '../../../engine/madara';
import type { Page } from '../../../engine/types';

// Derivation de cle OpenSSL EVP_BytesToKey (MD5, un seul tour): 32 octets
// de cle AES-256 et 16 octets d'IV, alimentes par mot_cle + sel en boucle.
function evpBytesToKey(password: string, salt: Buffer): Buffer {
  const blocks: Buffer[] = [];
  let previous = Buffer.alloc(0);
  while (Buffer.concat(blocks).length < 48) {
    previous = createHash('md5')
      .update(Buffer.concat([previous, Buffer.from(password), salt]))
      .digest();
    blocks.push(previous);
  }
  return Buffer.concat(blocks);
}

export class GourmetscansScraper extends MadaraScraper {
  constructor() { super('Gourmet Scans', 'https://gourmetsupremacy.com', 'en'); }
  protected override readonly mangaSubString = 'project';

  // La page de recherche expose nav.navigation-ajax, donc AutoDetect
  // basculerait sur admin-ajax, qui renvoie une reponse vide sur ce site.
  protected override readonly useLoadMoreRequest = 'Never';

  // Le chapitre est servi chiffre (WP-Manga chapter protector): le HTML ne
  // contient que des div.page-break vides. Les URL réelles sont dans
  // #chapter-protector-data, en AES-256-CBC, la cle etant derivee du nonce
  // de la page par EVP_BytesToKey. Le dechiffrement est donc obligatoire.
  public override async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const protector = $('#chapter-protector-data').text();

    const payload = protector.match(/chapter_data\s*=\s*'(\{[\s\S]*?\})'/)?.[1];
    const nonce = protector.match(/wpmangaprotectornonce\s*=\s*'([^']+)'/)?.[1];
    if (!payload || !nonce) {
      return $(this.pageListParseSelector).toArray().map((el, index) => {
        const $el = $(el);
        const img = $el.is('img') ? $el : $el.find('img').first();
        return { index, imageUrl: this.imageFromElement(img) || '' };
      }).filter(page => page.imageUrl.length > 0);
    }

    const { ct, iv, s } = JSON.parse(payload) as { ct: string; iv: string; s: string };
    const key = evpBytesToKey(nonce, Buffer.from(s, 'hex')).subarray(0, 32);
    const decipher = createDecipheriv('aes-256-cbc', key, Buffer.from(iv, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ct, 'base64')),
      decipher.final(),
    ]).toString('utf-8');

    // Le texte dechiffre est une chaine JSON contenant le tableau des URL.
    const urls = JSON.parse(JSON.parse(decrypted) as string) as string[];
    return urls.map((imageUrl, index) => ({ index, imageUrl }));
  }
}
