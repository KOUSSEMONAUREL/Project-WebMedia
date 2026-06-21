import { MiddlewareHandler } from 'hono';

const store = new Map<string, { count: number; resetAt: number }>();
const MAX_STORE_SIZE = 5000; // Sécurité anti-OOM (Out Of Memory)

export const rateLimitServer = (limit: number, windowSeconds: number): MiddlewareHandler => {
  return async (c, next) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
    const now = Date.now();
    const key = `ratelimit:${ip}`;

    let entry = store.get(key);
    if (!entry || now > entry.resetAt) {
      // Nettoyage préventif si la map est trop grande
      if (store.size >= MAX_STORE_SIZE) {
          const firstKey = store.keys().next().value;
          if (firstKey) store.delete(firstKey);
      }
      entry = { count: 1, resetAt: now + windowSeconds * 1000 };
      store.set(key, entry);
    } else {
      entry.count++;
    }

    if (entry.count > limit) {
      return c.json({ error: 'Too Many Requests', status: 429, message: 'Veuillez ralentir un peu...' }, 429);
    }

    await next();
  };
};

// Nettoyage régulier des entrées expirées
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 30000);
