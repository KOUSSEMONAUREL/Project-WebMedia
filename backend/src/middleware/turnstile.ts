import { Context, Next } from 'hono';
import { verifyCloudflareTurnstile } from '../lib/turnstile';

export async function turnstileMiddleware(c: Context, next: Next) {
    if (c.env?.ENVIRONMENT === 'development' || c.env?.ENVIRONMENT === 'test') {
        await next();
        return;
    }

    const token = c.req.header('X-Turnstile-Token');
    const secret = c.env?.TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET_KEY || '';

    if (!token || !secret) {
        return c.json({ success: false, error: 'Anti-bot verification required' }, 403);
    }

    const valid = await verifyCloudflareTurnstile(token, secret);
    if (!valid) {
        return c.json({ success: false, error: 'Anti-bot verification failed' }, 403);
    }

    await next();
}

