import { Hono } from 'hono';

type Bindings = {
    DB: D1Database;
    KV?: KVNamespace;
};

const staticRoutes = new Hono<{ Bindings: Bindings }>();
const STATIC_CACHE_TTL_S = 86_400; // 24h
const STATIC_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400';

// Helper universel pour les variables d'env
const getVar = (c: any, key: string) => {
    const val = c.env?.[key] || (process.env as any)[key];
    if (!val && c.env?.ENVIRONMENT === 'production') {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return val;
};

// ========== GET /api/static/genres ==========
staticRoutes.get('/genres', async (c) => {
    try {
        if (!c.env?.DB) {
            return c.json({ success: false, error: 'Base de données D1 non disponible sur cet environnement' }, 501);
        }
        const cacheKey = 'static:genres:v1';
        if (c.env?.KV) {
            const cached = await c.env.KV.get(cacheKey, 'json').catch(() => null);
            if (cached) {
                c.header('Cache-Control', STATIC_CACHE_CONTROL);
                return c.json({ success: true, data: cached });
            }
        }
        const { results } = await c.env.DB.prepare(
            "SELECT * FROM genres ORDER BY nom ASC"
        ).all();

        if (c.env?.KV && results.length > 0) {
            c.executionCtx?.waitUntil?.(
                c.env.KV.put(cacheKey, JSON.stringify(results), { expirationTtl: STATIC_CACHE_TTL_S }).catch(() => {})
            );
        }
        c.header('Cache-Control', STATIC_CACHE_CONTROL);
        return c.json({ success: true, data: results });
    } catch (error: any) {
        console.error('D1 Genres Error:', error.message);
        return c.json({ success: false, error: 'Erreur D1' }, 500);
    }
});

// ========== GET /api/static/plateformes ==========
staticRoutes.get('/plateformes', async (c) => {
    try {
        if (!c.env?.DB) {
            return c.json({ success: false, error: 'Base de données D1 non disponible sur cet environnement' }, 501);
        }
        const cacheKey = 'static:plateformes:v1';
        if (c.env?.KV) {
            const cached = await c.env.KV.get(cacheKey, 'json').catch(() => null);
            if (cached) {
                c.header('Cache-Control', STATIC_CACHE_CONTROL);
                return c.json({ success: true, data: cached });
            }
        }
        const { results } = await c.env.DB.prepare(
            "SELECT * FROM plateformes ORDER BY nom ASC"
        ).all();

        if (c.env?.KV && results.length > 0) {
            c.executionCtx?.waitUntil?.(
                c.env.KV.put(cacheKey, JSON.stringify(results), { expirationTtl: STATIC_CACHE_TTL_S }).catch(() => {})
            );
        }
        c.header('Cache-Control', STATIC_CACHE_CONTROL);
        return c.json({ success: true, data: results });
    } catch (error: any) {
        console.error('D1 Plateformes Error:', error.message);
        return c.json({ success: false, error: 'Erreur D1' }, 500);
    }
});

export default staticRoutes;
