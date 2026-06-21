import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql';
import postgres from 'postgres';
import { createClient } from '@libsql/client';
import * as neonSchema from './neon/schema';
import * as tursoSchema from './turso/schema';
/**
 * Client Neon/Postgres (Écriture - Source of Truth)
 */
export function createNeonClient(connectionString) {
    const client = postgres(connectionString, { prepare: false });
    return drizzlePg(client, { schema: neonSchema });
}
/**
 * Client Turso/LibSQL (Lecture - Edge)
 */
export function createTursoClient(url, authToken) {
    const client = createClient({ url, authToken });
    return drizzleLibsql(client, { schema: tursoSchema });
}
export function createDbClient(connectionString, type, authToken) {
    if (type === 'turso')
        return createTursoClient(connectionString, authToken);
    return createNeonClient(connectionString);
}
