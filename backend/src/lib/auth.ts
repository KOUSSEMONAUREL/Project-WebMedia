import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { getSupabaseClient } from '../db/singleton';
import * as schema from '../db/supabase/schema';

let _auth: ReturnType<typeof betterAuth> | null = null;

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
            trustedOrigins: [
                'https://project-web-media.vercel.app',
                'https://webmedia-proxy.koussemonaurel.workers.dev',
                'https://project-webmedia.onrender.com',
            ],
        },
        emailAndPassword: {
            enabled: true,
            autoSignIn: true,
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
    ];
    for (const key of keys) {
        if (env[key] && !process.env[key]) {
            (process.env as any)[key] = env[key];
        }
    }
}
