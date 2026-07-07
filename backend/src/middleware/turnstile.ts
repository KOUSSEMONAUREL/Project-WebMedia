import { Context, Next } from 'hono';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function verifyCloudflareTurnstile(token: string, secret: string): Promise<boolean> {
    if (!token || !secret) return false;
    try {
        const formData = new URLSearchParams();
        formData.append('secret', secret);
        formData.append('response', token);

        const res = await fetch(TURNSTILE_VERIFY_URL, {
            method: 'POST',
            body: formData,
        });
        const data = await res.json() as { success?: boolean };
        return data.success === true;
    } catch {
        return false;
    }
}

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

export async function verifyTurnstileHandler(c: Context) {
    const { token } = await c.req.json<{ token?: string }>();
    const secret = c.env?.TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET_KEY || '';

    if (!token) {
        return c.json({ success: false, error: 'Missing token' }, 400);
    }

    const valid = await verifyCloudflareTurnstile(token, secret);
    return c.json({ success: valid });
}
