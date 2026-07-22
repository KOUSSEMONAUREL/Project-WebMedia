/**
 * server.ts - Entry point for Render (Node.js)
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import 'dotenv/config';
import { rateLimitServer } from './middleware/ratelimit-server';
import { sessionMiddleware } from './middleware/session';
import { getAuth } from './lib/auth';

// Import des routes
import userRoutes from './routes/user';
import mediaRoutes from './routes/media';
import searchRoutes from './routes/search';
import reviewRoutes from './routes/reviews';
import staticRoutes from './routes/static';
import internalRoutes from './routes/internal';
import adminRoutes from './routes/admin';

type Variables = {
    user: import('./middleware/session').Variables['user'];
    session: import('./middleware/session').Variables['session'];
};

const app = new Hono<{ Bindings: any; Variables: Variables }>();

// ========== MIDDLEWARES GLOBAUX ==========
app.use('*', logger());
app.use('*', prettyJSON());

const allowedOrigins = [
    'https://app.webmediia.cfd',
    'https://webmediia.cfd',
    'https://www.webmediia.cfd',
    'http://localhost:3000',
    'https://project-web-media.vercel.app',
    'https://webmedia-front.koussemonaurel.workers.dev',
];

app.use('*', cors({
    origin: (origin) => {
        if (!origin || allowedOrigins.includes(origin)) return origin;
        return null;
    },
    credentials: true,
}));

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

// ========== BETTER AUTH HANDLER ==========
app.on(['POST', 'GET'], '/api/auth/*', async (c) => {
    const dbUrl = process.env.SUPABASE_DATABASE_URL || '';

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

    return getAuth(dbUrl).handler(c.req.raw);
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
    if (process.env.ENVIRONMENT === 'development' || process.env.ENVIRONMENT === 'test') return next();
    const path = c.req.path;
    if (path.startsWith('/api/search')) return rateLimitServer(10, 60)(c, next);
    const isSensitive = path.startsWith('/api/auth') || path.startsWith('/api/user');
    return rateLimitServer(isSensitive ? 20 : 60, 60)(c, next);
});

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
        service: 'WebMediia Backend API (Render)',
        environment: process.env.ENVIRONMENT || 'development',
    });
});

// ========== ERREURS ==========
app.notFound((c) => c.json({ error: 'Not Found', path: c.req.path }, 404));
app.onError((err, c) => {
    console.error(err);
    if (process.env.ENVIRONMENT === 'production') {
        return c.json({ error: 'Internal Server Error' }, 500);
    }
    return c.json({ error: err.message }, 500);
});

// ========== DÉMARRAGE ==========
const port = parseInt(process.env.PORT || '3000', 10);
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
    console.log(`WebMediia Backend demarre sur le port ${info.port} (0.0.0.0)`);
});
