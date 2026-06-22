import { createNeonClient, createTursoClient, createDbClient } from './client';

const _neonCache = new Map<string, ReturnType<typeof createNeonClient>>();
const _tursoCache = new Map<string, ReturnType<typeof createTursoClient>>();
const _supabaseCache = new Map<string, any>();

export function getNeonClient(connectionString: string, hyperdrive?: any) {
    const key = hyperdrive?.connectionString || connectionString;
    let cached = _neonCache.get(key);
    if (!cached) {
        cached = createNeonClient(connectionString, hyperdrive);
        _neonCache.set(key, cached);
    }
    return cached;
}

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
    let cached = _supabaseCache.get(connectionString);
    if (!cached) {
        cached = createDbClient(connectionString, 'supabase');
        _supabaseCache.set(connectionString, cached);
    }
    return cached;
}

export function getNeonDb(connectionString: string, hyperdrive?: any) {
    return getNeonClient(connectionString, hyperdrive).db;
}
