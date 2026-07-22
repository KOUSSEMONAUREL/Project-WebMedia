import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { rateLimit } from './middleware/ratelimit';
import { sessionMiddleware } from './middleware/session';
import { getAuth, ensureAuthEnv } from './lib/auth';

// Import des routes
import userRoutes from './routes/user';
import mediaRoutes from './routes/media';
import searchRoutes from './routes/search';
import reviewRoutes from './routes/reviews';
import staticRoutes from './routes/static';
import internalRoutes from './routes/internal';
import adminRoutes from './routes/admin';

// Types pour les bindings Cloudflare
type Bindings = {
    DB: D1Database;
    KV: KVNamespace;
    HYPERDRIVE: Hyperdrive;
    SUPABASE_DATABASE_URL: string;
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    NEON_DATABASE_URL: string;
    TURSO_DATABASE_URL: string;
    TURSO_AUTH_TOKEN: string;
    TMDB_API_KEY: string;
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    UPSTASH_REDIS_REST_URL: string;
    UPSTASH_REDIS_REST_TOKEN: string;
    INTERNAL_API_KEY: string;
    MONGODB_URI: string;
    ENVIRONMENT: string;
    TURNSTILE_SECRET_KEY: string;
    GOOGLE_BOOKS_API_KEY: string;
    TWITCH_CLIENT_ID: string;
    TWITCH_CLIENT_SECRET: string;
    GITHUB_TOKEN: string;
};

type Variables = {
    user: import('./middleware/session').Variables['user'];
    session: import('./middleware/session').Variables['session'];
};

// Initialisation de l'application Hono
export const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ========== GLOBAL MIDDLEWARES ==========
const allowedOrigins = ['https://app.webmediia.cfd', 'https://webmediia.cfd', 'https://www.webmediia.cfd', 'http://localhost:3000', 'https://project-web-media.vercel.app', 'https://webmedia-front.koussemonaurel.workers.dev'];

app.use('*', cors({
    origin: (origin) => {
        if (!origin || allowedOrigins.includes(origin)) {
            return origin;
        }
        return null;
    },
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'X-Internal-API-Key', 'X-Turnstile-Token'],
    exposeHeaders: ['Content-Type', 'Authorization'],
}));

app.use('*', logger());
app.use('*', prettyJSON());

// ========== BODY SIZE LIMIT (reject large payloads) ==========
app.use('/api/*', async (c, next) => {
    if (c.req.method === 'POST' || c.req.method === 'PUT' || c.req.method === 'PATCH') {
        const len = parseInt(c.req.header('content-length') || '0');
        if (len > 1024 * 100) {
            return c.json({ error: 'Payload too large', message: 'Maximum 100KB' }, 413);
        }
    }
    await next();
});

// ========== BETTER AUTH HANDLER (before other middlewares) ==========
app.on(['POST', 'GET'], '/api/auth/*', async (c) => {
    ensureAuthEnv({
        SUPABASE_DATABASE_URL: c.env?.SUPABASE_DATABASE_URL,
        GOOGLE_CLIENT_ID: c.env?.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: c.env?.GOOGLE_CLIENT_SECRET,
        BETTER_AUTH_SECRET: c.env?.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: c.env?.BETTER_AUTH_URL,
    });

    // Password validation for sign-up only
    if (c.req.method === 'POST' && c.req.path === '/api/auth/sign-up/email') {
        const cloned = c.req.raw.clone();
        const body: any = await cloned.json();
        const pw: string = body?.password || '';
        const name: string = body?.name || '';

        if (name.length > 12) {
            return c.json({ error: 'Nom trop long (max 12 caracteres)' }, 400);
        }

        if (pw.length < 8) {
            return c.json({ error: 'Minimum 8 caracteres' }, 400);
        }
        if (pw.length > 16) {
            return c.json({ error: 'Maximum 16 caracteres' }, 400);
        }
        if (!/[A-Z]/.test(pw)) {
            return c.json({ error: 'Au moins une lettre majuscule requise' }, 400);
        }
        if (!/[a-z]/.test(pw)) {
            return c.json({ error: 'Au moins une lettre minuscule requise' }, 400);
        }
        if (!/[0-9]/.test(pw)) {
            return c.json({ error: 'Au moins un chiffre requis' }, 400);
        }
        if (!/[^A-Za-z0-9]/.test(pw)) {
            return c.json({ error: 'Au moins un caractere special requis (!@#$%^&*)' }, 400);
        }
    }

    const dbUrl = c.env?.SUPABASE_DATABASE_URL || process.env.SUPABASE_DATABASE_URL || '';
    return getAuth(dbUrl)!.handler(c.req.raw);
});

// ========== API KEY MIDDLEWARE (routes internes uniquement) ==========
app.use('/api/internal/*', async (c, next) => {
    const expectedKey = c.env?.INTERNAL_API_KEY || process.env.INTERNAL_API_KEY || '';
    const providedKey = c.req.header('X-Internal-API-Key');
    if (!expectedKey || providedKey !== expectedKey) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
});

// ========== API MIDDLEWARES ==========
app.use('/api/*', async (c, next) => {
    const path = c.req.path;
    if (path.startsWith('/api/auth/') ||
        path.startsWith('/api/media/') ||
        path.startsWith('/api/search') ||
        path.startsWith('/api/reviews/') ||
        path.startsWith('/api/static')) {
        c.set('user', null);
        c.set('session', null);
        await next();
        return;
    }
    await sessionMiddleware(c, next);
});

app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/auth/')) return next();
    if (c.env?.ENVIRONMENT === 'development' || c.env?.ENVIRONMENT === 'test') return next();

    const path = c.req.path;
    if (path.startsWith('/api/search')) return rateLimit(10, 60)(c, next);
    const isSensitive = path.startsWith('/api/auth') || path.startsWith('/api/user');
    return rateLimit(isSensitive ? 20 : 60, 60)(c, next);
});


// ========== ROUTES ==========
app.route('/api/user', userRoutes);
app.route('/api/media', mediaRoutes);
app.route('/api/search', searchRoutes);
app.route('/api/reviews', reviewRoutes);
app.route('/api/static', staticRoutes);
app.route('/api/internal', internalRoutes);
app.route('/api/admin', adminRoutes);

// Health check (redirect if Accept is text/html, e.g. OAuth fallback)
app.get('/', (c) => {
    const accept = c.req.header('accept') || '';
    if (accept.includes('text/html')) {
        return c.redirect('https://webmedia-front.koussemonaurel.workers.dev', 302);
    }
    return c.json({
        status: 'ok',
        service: 'WebMediia Backend API',
        environment: c.env.ENVIRONMENT || 'development'
    });
});

// ========== GESTION DES ERREURS ==========
app.notFound((c) => c.json({ error: 'Not Found', path: c.req.path }, 404));
app.onError((err, c) => {
    console.error(err);
    if (c.env.ENVIRONMENT === 'production') {
        return c.json({ error: 'Internal Server Error' }, 500);
    }
    return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});

import { OrchestratorService } from './services/orchestrator';

// Export pour Cloudflare Workers
export default {
    fetch: app.fetch,
    async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
        console.log("Cron Triggered:", event.cron);
        const orchestrator = new OrchestratorService(env);
        ctx.waitUntil(orchestrator.resolveStaleMedia());
    }
};
