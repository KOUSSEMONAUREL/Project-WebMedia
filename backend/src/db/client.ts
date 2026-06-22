import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql';
import postgres from 'postgres';
import { createClient } from '@libsql/client';
import * as neonSchema from './neon/schema';
import * as tursoSchema from './turso/schema';
import * as supabaseSchema from './supabase/schema';

/**
 * Client Neon/Postgres (Écriture - Source of Truth)
 */
export function createNeonClient(connectionString: string, hyperdrive?: any) {
    // Si Hyperdrive est fourni, on l'utilise, sinon on utilise la string brute
    const finalConnString = hyperdrive?.connectionString || connectionString;
    const client = postgres(finalConnString, { prepare: false });
    const db = drizzlePg(client, { schema: neonSchema });
    return { db, client };
}

/**
 * Client Turso/LibSQL (Lecture - Edge)
 */
export function createTursoClient(url: string, authToken?: string) {
    const client = createClient({ url, authToken });
    return drizzleLibsql(client, { schema: tursoSchema });
}

// Types exportés
export type NeonClient = ReturnType<typeof createNeonClient>;
export type TursoClient = ReturnType<typeof createTursoClient>;

// Rétrocompat (à supprimer progressivement)
export function createDbClient(connectionString: string, type: 'neon' | 'supabase' | 'turso', env?: any): any {
    if (type === 'supabase') {
        const client = postgres(connectionString, { prepare: false });
        return drizzlePg(client, { schema: supabaseSchema });
    }
    if (type === 'turso') return createTursoClient(connectionString, env?.TURSO_AUTH_TOKEN);
    return createNeonClient(connectionString, env?.HYPERDRIVE).db;
}
