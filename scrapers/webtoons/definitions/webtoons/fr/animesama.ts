import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import * as cheerio from 'cheerio';

export class AnimeSamaScraper extends BaseScraper {
  readonly name = 'AnimeSama';
  readonly baseUrl = 'https://anime-sama.to';
  readonly lang = 'fr';

  private static readonly PANNEAU_SCAN_RE = /panneauScan\("(.+?)",\s*"(.+?)"\)/g;
  private static readonly CREER_LISTE_RE = /creerListe\((\d+),\s*(\d+)\)/g;
  private static readonly NEW_SP_RE = /newSP\((?:\d+(?:\.\d+)?|"(.*?)")\)/g;
  private static readonly SCANS_RE = /(Scans|\(|\))/g;

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getSearch('', page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getSearch('', page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get('/catalogue', {
      params: { 'type[0]': 'Scans', search: query, page: String(page) },
    });
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    $('#list_catalog > div').each((_, el) => {
        const href = $(el).find('a').first().attr('href') ?? '';
        const title = $(el).find('.card-title').text().trim();
        const thumb = $(el).find('img').attr('src') ?? '';
        if (title && href) {
            mangas.push({ title, url: href, thumbnailUrl: this.absUrl(thumb), lang: this.lang });
        }
    });
    const hasNextPage = $('#list_pagination > a.bg-sky-900 + a').length > 0;
    return { mangas, hasNextPage };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const masterRes = await this.get(mangaUrl);
    AnimeSamaScraper.PANNEAU_SCAN_RE.lastIndex = 0;
    const panneaux = [...masterRes.data.matchAll(AnimeSamaScraper.PANNEAU_SCAN_RE)]
        .map(m => ({ title: m[1], url: m[2] }));

    const vfPanneaux = panneaux.filter(p => !p.url.includes('va'));
    if (vfPanneaux.length === 0) return [];

    const allChapters: Chapter[] = [];
    for (const panneau of vfPanneaux) {
        const scanlator = panneau.title.replace(AnimeSamaScraper.SCANS_RE, '').trim();
        const vfRes = await this.get(panneau.url);
        const $ = this.$(vfRes.data);
        const title = ($('#titreOeuvre').contents().filter((_, n: any) => n.type === 'text').first().text() || $('#titreOeuvre').text()).trim();
        
        const apiRes = await this.get(`/s2/scans/get_nb_chap_et_img.php`, { params: { oeuvre: title } });
        const apiJson = apiRes.data;

        const chapters: Chapter[] = [];
        let chapterDelay = 0;
        const fullHtml = $.html();

        if (fullHtml.includes('resetListe()')) {
            const lines = fullHtml.split(';');
            for (const line of lines) {
                AnimeSamaScraper.CREER_LISTE_RE.lastIndex = 0;
                AnimeSamaScraper.NEW_SP_RE.lastIndex = 0;
                
                const creerMatch = AnimeSamaScraper.CREER_LISTE_RE.exec(line);
                if (creerMatch) {
                    const start = parseInt(creerMatch[1]);
                    const end = parseInt(creerMatch[2]);
                    for (let i = start; i <= end; i++) {
                        chapters.push({ 
                            name: `Chapitre ${i}`, 
                            url: `/s2/scans/get_nb_chap_et_img.php?oeuvre=${encodeURIComponent(title)}&id=${chapters.length + 1}`,
                            chapterNumber: i 
                        });
                    }
                    continue;
                }
                const spMatch = AnimeSamaScraper.NEW_SP_RE.exec(line);
                if (spMatch) {
                    const rawName = spMatch[1];
                    chapters.push({ 
                        name: `Chapitre ${rawName}`, 
                        url: `/s2/scans/get_nb_chap_et_img.php?oeuvre=${encodeURIComponent(title)}&id=${chapters.length + 1}`
                    });
                    chapterDelay++;
                }
            }
        }
        allChapters.push(...chapters);
    }
    return allChapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const url = new URL(this.absUrl(chapterUrl));
    const oeuvre = url.searchParams.get('oeuvre') ?? '';
    const id = url.searchParams.get('id') ?? '';
    
    const apiRes = await this.get(`/s2/scans/get_nb_chap_et_img.php?oeuvre=${encodeURIComponent(oeuvre)}`);
    const imageCount = apiRes.data[id] ?? 0;
    
    return Array.from({ length: imageCount }, (_, i) => ({
        imageUrl: this.absUrl(`/s2/scans/${encodeURIComponent(oeuvre)}/${id}/${i + 1}.jpg`),
        index: i,
    }));
  }
}
