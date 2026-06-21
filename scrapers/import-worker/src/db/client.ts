import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql';
import postgres from 'postgres';
import { createClient } from '@libsql/client';
import * as neonSchema from './neon/schema.js';
import * as tursoSchema from './turso/schema.js';

/**
 * Client Neon/Postgres (Écriture - Source of Truth)
 */
export function createNeonClient(connectionString: string) {
    const client = postgres(connectionString, { prepare: false });
    return drizzlePg(client, { schema: neonSchema });
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
export function createDbClient(connectionString: string, type: 'neon'): NeonClient;
export function createDbClient(connectionString: string, type: 'turso', authToken?: string): TursoClient;
export function createDbClient(connectionString: string, type: 'neon' | 'turso', authToken?: string): NeonClient | TursoClient {
    if (type === 'turso') return createTursoClient(connectionString, authToken);
    return createNeonClient(connectionString);
}
