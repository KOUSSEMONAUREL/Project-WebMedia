import { Hono } from 'hono';
import { jwtVerify } from 'jose';

type Bindings = {
    KV: KVNamespace;
    BACKEND_URL: string;
    INTERNAL_API_KEY: string;
    JWT_SECRET: string;
    ENVIRONMENT: string;
    UPSTASH_REDIS_REST_URL: string;
    UPSTASH_REDIS_REST_TOKEN: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Cache TTL configuration
const CACHE_TTL = {
    TRENDING: 3600, // 1 hour
    SEARCH: 600,    // 10 minutes
    MEDIA: 21600,   // 6 hours
    STATIC: 86400   // 24 hours
};


// Rate Limiting via Upstash REST

async function rateLimit(c: any, ip: string) {
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
            // Premier appel, on met un TTL de 60s
            await fetch(`${UPSTASH_REDIS_REST_URL}/EXPIRE/${key}/60`, {
                headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` }
            });
        }

        return result <= 100; // 100 req / min
    } catch (e) {
        return true; // En cas d'erreur Redis, on laisse passer
    }
}

// Middleware: API Gateway Strategy
app.all('*', async (c) => {
    const url = new URL(c.req.url);
    const path = url.pathname;
    const ip = c.req.header('cf-connecting-ip') || '127.0.0.1';

    // 1. Rate Limiting Sélectif (Uniquement Auth et Recherche pour économiser Upstash)
    if (path.startsWith('/api/auth/') || path.startsWith('/api/search')) {
        const isAllowed = await rateLimit(c, ip);
        if (!isAllowed) {
            return c.json({ error: 'Too Many Requests', message: 'Veuillez ralentir un peu...' }, 429);
        }
    }

    // 2. JWT Verification pour les routes protégées
    if (path.startsWith('/api/user/') || path.startsWith('/api/reviews/post')) {
        const authHeader = c.req.header('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return c.json({ error: 'Unauthorized', message: 'Token manquant' }, 401);
        }
        const token = authHeader.split(' ')[1];
        try {
            await jwtVerify(token, new TextEncoder().encode(c.env.JWT_SECRET));
        } catch (e) {
            return c.json({ error: 'Unauthorized', message: 'Token invalide' }, 401);
        }
    }

    // 3. Gestion du Cache Edge (KV) pour les GET fréquents
    if (c.req.method === 'GET') {
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
            } catch { /* KV indisponible, on proxyfie */ }
        }
    }

    // 4. Proxy vers le Backend (Render/Hono)
    const targetUrl = `${c.env.BACKEND_URL}${path}${url.search}`;
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

        // 5. Post-processing : Mettre en cache si c'est un succès
        if (response.ok && c.req.method === 'GET') {
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
