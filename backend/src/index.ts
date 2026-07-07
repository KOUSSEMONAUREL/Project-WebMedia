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
};

type Variables = {
    user: import('./middleware/session').Variables['user'];
    session: import('./middleware/session').Variables['session'];
};

// Initialisation de l'application Hono
export const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ========== GLOBAL MIDDLEWARES ==========
const allowedOrigins = ['https://app.webmedia.com', 'https://webmedia.com', 'http://localhost:3000', 'https://project-web-media.vercel.app'];

app.use('*', cors({
    origin: (origin) => {
        if (!origin || allowedOrigins.includes(origin)) {
            return origin;
        }
        return null;
    },
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'X-Internal-API-Key'],
    exposeHeaders: ['Content-Type', 'Authorization'],
}));

app.use('*', logger());
app.use('*', prettyJSON());

// ========== BETTER AUTH HANDLER (before other middlewares) ==========
app.on(['POST', 'GET'], '/api/auth/*', async (c) => {
    ensureAuthEnv({
        SUPABASE_DATABASE_URL: c.env?.SUPABASE_DATABASE_URL,
        GOOGLE_CLIENT_ID: c.env?.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: c.env?.GOOGLE_CLIENT_SECRET,
        BETTER_AUTH_SECRET: c.env?.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: c.env?.BETTER_AUTH_URL,
    });
    const dbUrl = c.env?.SUPABASE_DATABASE_URL || process.env.SUPABASE_DATABASE_URL || '';
    return getAuth(dbUrl)!.handler(c.req.raw);
});

// ========== API KEY MIDDLEWARE (toutes les routes /api/*) ==========
app.use('/api/*', async (c, next) => {
    const expectedKey = c.env?.INTERNAL_API_KEY || process.env.INTERNAL_API_KEY || '';
    const providedKey = c.req.header('X-Internal-API-Key');
    if (!expectedKey || providedKey !== expectedKey) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
});

// ========== API MIDDLEWARES ==========
app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/auth/')) {
        await next();
        return;
    }
    await sessionMiddleware(c, next);
});

app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/auth/')) return next();
    if (c.env?.ENVIRONMENT === 'development' || c.env?.ENVIRONMENT === 'test') return next();

    const path = c.req.path;
    const isSensitive = path.startsWith('/api/auth') || path.startsWith('/api/search') || path.startsWith('/api/user');
    return rateLimit(isSensitive ? 60 : 200, 60)(c, next);
});

// ========== TURNSTILE ANTI-BOT ==========
import { verifyTurnstileHandler } from './middleware/turnstile';
app.post('/api/verify-turnstile', verifyTurnstileHandler);

// ========== ROUTES ==========
app.route('/api/user', userRoutes);
app.route('/api/media', mediaRoutes);
app.route('/api/search', searchRoutes);
app.route('/api/reviews', reviewRoutes);
app.route('/api/static', staticRoutes);
app.route('/api/internal', internalRoutes);
app.route('/api/admin', adminRoutes);

// Health check
app.get('/', (c) => {
    return c.json({
        status: 'ok',
        service: 'WebMedia Backend API',
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
