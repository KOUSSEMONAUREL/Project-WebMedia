import { AsyncLocalStorage } from 'node:async_hooks';
import { createNeonClient, createTursoClient, createSupabaseDbClient, createSupabaseHttpClient } from './client';

const requestNeon = new AsyncLocalStorage<ReturnType<typeof createNeonClient>>();

export function runWithNeonClient<T>(
    connectionString: string,
    hyperdrive: any,
    fn: () => Promise<T>,
    waitUntil?: (promise: Promise<any>) => void
): Promise<T> {
    const client = createNeonClient(connectionString, hyperdrive);
    return requestNeon.run(client, async () => {
        try {
            return await fn();
        } finally {
            if (waitUntil) waitUntil(client.client.end());
            else await client.client.end();
        }
    });
}

export function getNeonClient(connectionString: string, hyperdrive?: any) {
    return createNeonClient(connectionString, hyperdrive);
}

const _tursoCache = new Map<string, ReturnType<typeof createTursoClient>>();

export function getTursoClient(url: string, authToken?: string) {
    const key = `${url}:${authToken || ''}`;
    let cached = _tursoCache.get(key);
    if (!cached) {
        cached = createTursoClient(url, authToken);
        _tursoCache.set(key, cached);
    }
    return cached;
}

export function getSupabaseClient(connectionString: string) {
    return createSupabaseDbClient(connectionString);
}

const _supabaseHttpCache = new Map<string, ReturnType<typeof createSupabaseHttpClient>>();

export function getSupabaseHttpClient(supabaseUrl: string, supabaseKey: string) {
    const key = `${supabaseUrl}:${supabaseKey}`;
    let cached = _supabaseHttpCache.get(key);
    if (!cached) {
        cached = createSupabaseHttpClient(supabaseUrl, supabaseKey);
        _supabaseHttpCache.set(key, cached);
    }
    return cached;
}

export function getNeonDb(connectionString: string, hyperdrive?: any) {
    const scoped = requestNeon.getStore();
    return (scoped || getNeonClient(connectionString, hyperdrive)).db;
}
