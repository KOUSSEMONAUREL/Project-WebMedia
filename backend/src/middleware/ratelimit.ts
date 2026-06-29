import { MiddlewareHandler } from 'hono';

export const rateLimit = (limit: number, windowSeconds: number): MiddlewareHandler => {
    return async (c, next) => {
        if (c.req.method === 'OPTIONS') return await next();

        const ip = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
        const url = c.env.UPSTASH_REDIS_REST_URL;
        const token = c.env.UPSTASH_REDIS_REST_TOKEN;

        if (!url || !token) return await next();

        const key = `ratelimit:${ip}`;

        // On utilise l'API REST d'Upstash via fetch pour le middleware
        let current = 0;
        try {
            const res = await fetch(`${url}/INCR/${key}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data: any = await res.json();
            current = parseInt(data.result) || 0;

            if (current === 1) {
                await fetch(`${url}/EXPIRE/${key}/${windowSeconds}`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
            }
        } catch { /* Upstash indisponible, on laisse passer */ }

        if (current > limit) {
            return c.json({ error: 'Too Many Requests', message: 'Veuillez ralentir un peu...' }, 429);
        }

        await next();
    };
};
