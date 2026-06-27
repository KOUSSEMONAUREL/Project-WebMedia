import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

type Bindings = {
    KV: KVNamespace;
};

const webtoonRoutes = new Hono<{ Bindings: Bindings }>();

// Helper universel pour les variables d'env
const getVar = (c: any, key: string) => {
    const val = c.env?.[key] || (process.env as any)[key];
    if (!val && c.env?.ENVIRONMENT === 'production') {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return val;
};

async function getRunner() {
    // Dans Cloudflare Workers, on ne peut pas importer dynamiquement des fichiers de scraper en dehors du bundle
    // Cette route est donc principalement fonctionnelle sur Render (Node.js) pour l'instant.
    const isNode = typeof process !== 'undefined' && process.versions && !!process.versions.node;
    
    if (!isNode) {
        throw new Error("Webtoon endpoints ne sont pas encore compatibles avec Cloudflare Edge (Node.js requis pour les imports dynamiques de scrapers)");
    }

    try {
        const runnerPath = '../lib/scrapers/runner';
        const mod = await import(runnerPath);
        return mod as { listScrapers: Function; getScraper: Function; getScraperForUrl: Function };
    } catch (err: any) {
        throw new Error(`Webtoon scrapers non accessibles: ${err.message}`);
    }
}

webtoonRoutes.get('/', async (c) => {
    try {
        const cacheKey = 'webtoon:scrapers';
        const cached = c.env?.KV ? await c.env.KV.get(cacheKey, 'json') : null;
        if (cached) return c.json({ success: true, data: cached, source: 'cache' });

        const { listScrapers } = await getRunner();
        const scrapers = listScrapers();
        const grouped: Record<string, { name: string; lang: string }[]> = {};
        for (const s of scrapers) {
            (grouped[s.lang] ||= []).push({ name: s.name, lang: s.lang });
        }

        if (c.env?.KV && c.executionCtx) {
            c.executionCtx.waitUntil(
                c.env.KV.put(cacheKey, JSON.stringify(grouped), { expirationTtl: 3600 })
            );
        }

        return c.json({ success: true, data: grouped, count: scrapers.length });
    } catch (error: any) {
        console.error('Erreur liste scrapers:', error.message);
        return c.json({ success: false, error: error.message }, 500);
    }
});

webtoonRoutes.get('/:source', async (c) => {
    const source = c.req.param('source');
    const url = c.req.query('url');

    // Validation basique de l'URL pour éviter SSRF/erreurs
    if (url) {
        try { new URL(url); } catch { return c.json({ success: false, error: 'Invalid URL format' }, 400); }
    }

    try {
        const { getScraper } = await getRunner();
        const scraper = await getScraper(source);
        if (!scraper) {
            return c.json({ success: false, error: `Scraper "${source}" not found` }, 404);
        }

        if (url) {
            const [chapters, details] = await Promise.all([
                scraper.getChapterList(url).catch(() => []),
                scraper.getMangaDetails(url).catch(() => ({}))
            ]);
            return c.json({ success: true, data: { details, chapters } });
        }

        const popular = await scraper.getPopular(1);
        return c.json({ success: true, data: { mangas: popular.mangas, hasNextPage: popular.hasNextPage } });
    } catch (error: any) {
        console.error(`Erreur scraper ${source}:`, error.message);
        return c.json({ success: false, error: error.message }, 500);
    }
});

webtoonRoutes.get('/:source/chapters', async (c) => {
    const source = c.req.param('source');
    const url = c.req.query('url');
    if (!url) return c.json({ success: false, error: 'url query param required' }, 400);

    try {
        try { new URL(url); } catch { return c.json({ success: false, error: 'Invalid URL format' }, 400); }
        const { getScraper } = await getRunner();
        const scraper = await getScraper(source);
        if (!scraper) return c.json({ success: false, error: `Scraper "${source}" not found` }, 404);

        const chapters = await scraper.getChapterList(url);
        return c.json({ success: true, data: chapters });
    } catch (error: any) {
        return c.json({ success: false, error: error.message }, 500);
    }
});

webtoonRoutes.get('/:source/pages', async (c) => {
    const source = c.req.param('source');
    const url = c.req.query('url');
    if (!url) return c.json({ success: false, error: 'url query param required' }, 400);

    try {
        try { new URL(url); } catch { return c.json({ success: false, error: 'Invalid URL format' }, 400); }
        const { getScraper } = await getRunner();
        const scraper = await getScraper(source);
        if (!scraper) return c.json({ success: false, error: `Scraper "${source}" not found` }, 404);

        const pages = await scraper.getPageList(url);
        return c.json({ success: true, data: pages });
    } catch (error: any) {
        return c.json({ success: false, error: error.message }, 500);
    }
});

webtoonRoutes.get('/resolve/url', async (c) => {
    const url = c.req.query('url');
    if (!url) return c.json({ success: false, error: 'url query param required' }, 400);

    try {
        const { getScraperForUrl } = await getRunner();
        const scraper = await getScraperForUrl(url);
        if (!scraper) return c.json({ success: false, error: 'No scraper found for this URL' }, 404);

        return c.json({ success: true, data: { name: scraper.name, baseUrl: scraper.baseUrl } });
    } catch (error: any) {
        return c.json({ success: false, error: error.message }, 500);
    }
});

export default webtoonRoutes;
