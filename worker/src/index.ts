import { Hono } from 'hono';

type Bindings = {
    KV: KVNamespace;
    INTERNAL_API_KEY: string;
    ENVIRONMENT: string;
    UPSTASH_REDIS_REST_URL: string;
    UPSTASH_REDIS_REST_TOKEN: string;
    WORKER_BACKEND_URL: string;
    RENDER_BACKEND_URL: string;
};

const app = new Hono<{ Bindings: Bindings }>();

const CACHE_TTL = {
    TRENDING: 3600,
    SEARCH: 600,
    MEDIA: 21600,
    STATIC: 86400
};

async function rateLimit(c: any, ip: string, limit = 100, windowSec = 60) {
    const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = c.env;
    if (!UPSTASH_REDIS_REST_URL) return true;

    const key = `ratelimit:${ip}`;
    const url = `${UPSTASH_REDIS_REST_URL}/INCR/${key}`;

    try {
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` }
        });
        const { result } = await res.json() as any;

        if (result === 1) {
            await fetch(`${UPSTASH_REDIS_REST_URL}/EXPIRE/${key}/${windowSec}`, {
                headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` }
            });
        }

        return result <= limit;
    } catch (e) {
        return true;
    }
}

function pickBackend(path: string, env: Bindings): string {
    if (path.startsWith('/api/internal/')) {
        return env.WORKER_BACKEND_URL;
    }
    return env.RENDER_BACKEND_URL;
}

app.all('*', async (c) => {
    const url = new URL(c.req.url);
    const path = url.pathname;
    const ip = c.req.header('cf-connecting-ip') || '127.0.0.1';

    // Rate Limiting
    if (path.startsWith('/api/auth/') || path.startsWith('/api/search')) {
        const isAllowed = await rateLimit(c, ip, 100, 60);
        if (!isAllowed) {
            return c.json({ error: 'Too Many Requests', message: 'Veuillez ralentir un peu...' }, 429);
        }
    }
    // Webtoon: stricter rate limit (20 req/min)
    if (path.startsWith('/api/webtoon/')) {
        const isAllowed = await rateLimit(c, ip, 20, 60);
        if (!isAllowed) {
            return c.json({ error: 'Too Many Requests', message: 'Trop de requêtes webtoon, ralentissez.' }, 429);
        }
    }

    // Edge Cache for frequent GET requests (only for Render-backed routes)
    const cacheablePaths = [
        '/api/media/trending',
        '/api/search',
        '/api/media/',
        '/api/static/'
    ];
    const isCacheableRoute = cacheablePaths.some(p => path === p || path.startsWith(p));

    if (c.req.method === 'GET' && isCacheableRoute) {
        let cacheKey = '';
        let ttl = 0;

        if (path === '/api/media/trending') {
            cacheKey = 'trending:all';
            ttl = CACHE_TTL.TRENDING;
        } else if (path === '/api/search') {
            const q = url.searchParams.get('q') || '';
            const type = url.searchParams.get('type') || 'all';
            const offset = url.searchParams.get('offset') || '0';
            const limit = url.searchParams.get('limit') || '20';
            cacheKey = `search:${q}:${type}:${offset}:${limit}`;
            ttl = CACHE_TTL.SEARCH;
        } else if (path.startsWith('/api/media/') && path.split('/').length === 5) {
            cacheKey = `media:${path.replace('/api/media/', '').replace(/\//g, ':')}`;
            ttl = CACHE_TTL.MEDIA;
        } else if (path.startsWith('/api/static/')) {
            cacheKey = `static:${path.split('/').pop()}`;
            ttl = CACHE_TTL.STATIC;
        }

        if (cacheKey) {
            try {
                const cached = await c.env.KV.get(cacheKey);
                if (cached) {
                    return c.json(JSON.parse(cached), 200, { 'X-Cache': 'HIT' });
                }
            } catch { /* KV unavailable */ }
        }
    }

    // Smart Routing: pick backend based on path
    const backendUrl = pickBackend(path, c.env);
    const targetUrl = `${backendUrl}${path}${url.search}`;

    const headers = new Headers(c.req.header());
    headers.delete('host');
    headers.delete('cf-connecting-ip');
    headers.delete('cf-ray');
    headers.delete('cf-visitor');
    headers.delete('cf-worker');
    headers.set('X-Forwarded-For', ip);

    try {
        const response = await fetch(targetUrl, {
            method: c.req.method,
            headers: headers,
            body: c.req.raw.body
        });

        // Post-processing: Cache successful GET responses (only for cacheable routes)
        if (response.ok && c.req.method === 'GET' && isCacheableRoute) {
            const clonedRes = response.clone();
            const data = await clonedRes.json();

            let cacheKey = '';
            let ttl = 0;
            if (path === '/api/media/trending') { cacheKey = 'trending:all'; ttl = CACHE_TTL.TRENDING; }
            else if (path === '/api/search') { cacheKey = `search:${url.searchParams.get('q')}:${url.searchParams.get('type') || 'all'}:${url.searchParams.get('offset') || '0'}:${url.searchParams.get('limit') || '20'}`; ttl = CACHE_TTL.SEARCH; }
            else if (path.startsWith('/api/media/') && path.split('/').length === 5) { cacheKey = `media:${path.replace('/api/media/', '').replace(/\//g, ':')}`; ttl = CACHE_TTL.MEDIA; }
            else if (path.startsWith('/api/static/')) { cacheKey = `static:${path.split('/').pop()}`; ttl = CACHE_TTL.STATIC; }

            if (cacheKey && ttl > 0) {
                c.executionCtx.waitUntil(
                    c.env.KV.put(cacheKey, JSON.stringify(data), { expirationTtl: ttl })
                );
            }
            return c.json(data, response.status as any, { 'X-Cache': 'MISS' });
        }

        return response;
    } catch (err) {
        console.error('Proxy Error:', err);
        return c.json({ error: 'Backend Bridge Error', message: 'Le service WebMedia est temporairement indisponible' }, 502);
    }
});

export default app;
