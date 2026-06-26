import { Hono } from 'hono';

type Bindings = {
    DB: D1Database;
};

const staticRoutes = new Hono<{ Bindings: Bindings }>();

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
        const { results } = await c.env.DB.prepare(
            "SELECT * FROM genres ORDER BY nom ASC"
        ).all();

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
        const { results } = await c.env.DB.prepare(
            "SELECT * FROM plateformes ORDER BY nom ASC"
        ).all();

        return c.json({ success: true, data: results });
    } catch (error: any) {
        console.error('D1 Plateformes Error:', error.message);
        return c.json({ success: false, error: 'Erreur D1' }, 500);
    }
});

export default staticRoutes;
