import { createMiddleware } from 'hono/factory';
import { getAuth } from '../lib/auth';

type Variables = {
    user: {
        id: string;
        name: string;
        email: string;
        emailVerified: boolean;
        image?: string | null;
        username?: string | null;
    } | null;
    session: {
        id: string;
        userId: string;
        token: string;
        expiresAt: Date;
    } | null;
};

export const sessionMiddleware = createMiddleware<{ Bindings: any; Variables: Variables }>(async (c, next) => {
    try {
        const dbUrl = c.env?.SUPABASE_DATABASE_URL || process.env.SUPABASE_DATABASE_URL || '';
        if (!dbUrl) {
            c.set('user', null);
            c.set('session', null);
            await next();
            return;
        }
        const auth = getAuth(dbUrl);
        if (!auth) {
            c.set('user', null);
            c.set('session', null);
            await next();
            return;
        }
        const session = await auth.api.getSession({
            headers: c.req.raw.headers,
        });

        if (!session) {
            c.set('user', null);
            c.set('session', null);
        } else {
            c.set('user', session.user as Variables['user']);
            c.set('session', session.session as Variables['session']);
        }
    } catch {
        c.set('user', null);
        c.set('session', null);
    }
    await next();
});

export type { Variables };
