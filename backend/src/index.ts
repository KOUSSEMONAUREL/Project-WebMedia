import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { rateLimit } from './middleware/ratelimit';

// Import des routes
import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import mediaRoutes from './routes/media';
import searchRoutes from './routes/search';
import reviewRoutes from './routes/reviews';
import staticRoutes from './routes/static';
import internalRoutes from './routes/internal';
import webtoonRoutes from './routes/webtoon';

// Types pour les bindings Cloudflare
type Bindings = {
    DB: D1Database;
    KV: KVNamespace;
    HYPERDRIVE: Hyperdrive;
    SUPABASE_DATABASE_URL: string;
    NEON_DATABASE_URL: string;
    TURSO_DATABASE_URL: string;
    TURSO_AUTH_TOKEN: string;
    JWT_SECRET: string;
    TMDB_API_KEY: string;
    UPSTASH_REDIS_REST_URL: string;
    UPSTASH_REDIS_REST_TOKEN: string;
    INTERNAL_API_KEY: string;
    MONGODB_URI: string;
    ENVIRONMENT: string;
};

// Initialisation de l'application Hono
export const app = new Hono<{ Bindings: Bindings }>();

// ========== RATE LIMITING GLOBAL ==========
app.use('/api/*', async (c, next) => {
    if (c.env.ENVIRONMENT === 'development' || c.env.ENVIRONMENT === 'test') return next();

    const path = c.req.path;
    const isSensitive = path.startsWith('/api/auth') || path.startsWith('/api/search') || path.startsWith('/api/user');
    return rateLimit(isSensitive ? 60 : 200, 60)(c, next);
});

app.use('*', logger());
app.use('*', prettyJSON());

// Origins autorisés en prod
const allowedOrigins = ['https://app.webmedia.com', 'https://webmedia.com', 'http://localhost:3000'];

app.use('*', cors({
    origin: (origin) => {
        if (!origin || allowedOrigins.includes(origin)) {
            return origin;
        }
        return null;
    },
    credentials: true,
}));

// ========== ROUTES ==========
app.route('/api/auth', authRoutes);
app.route('/api/user', userRoutes);
app.route('/api/media', mediaRoutes);
app.route('/api/search', searchRoutes);
app.route('/api/reviews', reviewRoutes);
app.route('/api/static', staticRoutes);
app.route('/api/internal', internalRoutes);
app.route('/api/webtoon', webtoonRoutes);

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
        return c.json({ error: 'Internal Server Error' }, 500); // Masquer le message d'erreur en prod
    }
    return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});

import { OrchestratorService } from './services/orchestrator';

// Export pour Cloudflare Workers
export default {
    fetch: app.fetch,
    async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
        console.log("⏰ Cron Triggered:", event.cron);
        const orchestrator = new OrchestratorService(env);
        ctx.waitUntil(orchestrator.resolveStaleMedia());
    }
};
