import type { APIRoute } from 'astro';
import { getAllMedia } from '../lib/api';
import type { Media } from '../lib/api';

export const prerender = true;

export const GET: APIRoute = async () => {
  const site = 'https://www.webmediia.cfd';

  const staticPages = [
    { loc: '', changefreq: 'daily', priority: '1.0' },
    { loc: '/films', changefreq: 'daily', priority: '0.9' },
    { loc: '/series', changefreq: 'daily', priority: '0.9' },
    { loc: '/animes', changefreq: 'daily', priority: '0.9' },
    { loc: '/games', changefreq: 'weekly', priority: '0.7' },
    { loc: '/books', changefreq: 'weekly', priority: '0.7' },
    { loc: '/novels', changefreq: 'weekly', priority: '0.7' },
    { loc: '/comics', changefreq: 'weekly', priority: '0.7' },
    { loc: '/webtoons', changefreq: 'weekly', priority: '0.7' },
    { loc: '/trending', changefreq: 'daily', priority: '0.8' },
    { loc: '/genres', changefreq: 'weekly', priority: '0.6' },
    { loc: '/about', changefreq: 'monthly', priority: '0.3' },
    { loc: '/legal', changefreq: 'monthly', priority: '0.3' },
    { loc: '/search', changefreq: 'weekly', priority: '0.4' },
  ];

  let mediaItems: Media[] = [];
  try {
    const all = await getAllMedia();
    mediaItems = all || [];
  } catch (e) {
    console.error('[sitemap] getAllMedia error:', e);
  }

  const typeSlug: Record<string, string> = {
    film: 'films', serie: 'series', anime: 'animes',
    jeu: 'games', webtoon: 'webtoons', comic: 'comics',
    book: 'books', novel: 'novels',
  };

  const urls = [
    ...staticPages,
    ...mediaItems.map((m) => {
      const prefix = typeSlug[m.type] || m.type;
      return { loc: `/${prefix}/${m.slug || m.id}`, changefreq: 'weekly' as const, priority: '0.5' };
    }),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${site}${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'application/xml' },
  });
};
