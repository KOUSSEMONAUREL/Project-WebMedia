import { betterAuth } from 'better-auth';
import { bearer } from 'better-auth/plugins';
import { createAuthMiddleware } from 'better-auth/api';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { getSupabaseClient } from '../db/singleton';
import * as schema from '../db/supabase/schema';
import { verifyCloudflareTurnstile } from './turnstile';

const TURNSTILE_PROTECTED_PATHS = [
    '/sign-in/email',
    '/sign-up/email',
    '/forgot-password',
    '/reset-password',
    '/change-password',
    '/send-verification-email',
];

let _auth: any = null;

export function getAuth(dbUrl?: string) {
    if (_auth) return _auth;

    const url = dbUrl || process.env.SUPABASE_DATABASE_URL || '';
    if (!url) {
        throw new Error('SUPABASE_DATABASE_URL is required for auth');
    }

    const db = getSupabaseClient(url);
    _auth = betterAuth({
        database: drizzleAdapter(db, {
            provider: 'pg',
            schema: {
                user: schema.user,
                session: schema.session,
                account: schema.account,
                verification: schema.verification,
            },
        }),
        advanced: {
            defaultCookieAttributes: {
                sameSite: 'none',
                secure: true,
            },
            crossSubDomainCookies: {
                enabled: false,
            },
            ipAddress: {
                ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'],
                trustedProxies: ['0.0.0.0/0'],
            },
        },
        trustedOrigins: [
            'https://project-web-media.vercel.app',
            'https://webmedia-backend.koussemonaurel.workers.dev',
        ],
        emailAndPassword: {
            enabled: true,
            autoSignIn: false,
            requireEmailVerification: false,
            minPasswordLength: 8,
            sendResetPassword: async ({ user, url }) => {
                const { sendMail, buildResetEmail } = await import('./email');
                const { subject, html } = buildResetEmail(user.name, url);
                await sendMail(user.email, subject, html);
            },
        },
        emailVerification: {
            sendVerificationEmail: async ({ user, url }) => {
                const { sendMail, buildVerificationEmail } = await import('./email');
                const { subject, html } = buildVerificationEmail(user.name, url);
                await sendMail(user.email, subject, html);
            },
            sendOnSignUp: true,
            autoSignInAfterVerification: true,
        },
        socialProviders: {
            google: {
                clientId: process.env.GOOGLE_CLIENT_ID || '',
                clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
            },
        },
        user: {
            additionalFields: {
                username: {
                    type: 'string',
                    required: false,
                    input: true,
                },
            },
        },
        plugins: [bearer()],
        hooks: {
            before: createAuthMiddleware(async (ctx) => {
                if (!TURNSTILE_PROTECTED_PATHS.includes(ctx.path)) return;

                const token = ctx.body?.turnstileToken as string | undefined;
                const secret = process.env.TURNSTILE_SECRET_KEY || '';

                if (!token || !secret) {
                    throw new APIError('FORBIDDEN', {
                        message: token
                            ? 'Anti-bot verification failed'
                            : 'Anti-bot verification required',
                    });
                }

                const valid = await verifyCloudflareTurnstile(token, secret);
                if (!valid) {
                    throw new APIError('FORBIDDEN', {
                        message: 'Anti-bot verification failed',
                    });
                }
            }),
        },
    });
    return _auth;
}

export function ensureAuthEnv(env: Record<string, string | undefined>) {
    const keys: Array<keyof typeof env> = [
        'SUPABASE_DATABASE_URL',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'BETTER_AUTH_SECRET',
        'BETTER_AUTH_URL',
        'TURNSTILE_SECRET_KEY',
    ];
    for (const key of keys) {
        if (env[key] && !process.env[key]) {
            (process.env as any)[key] = env[key];
        }
    }
}
