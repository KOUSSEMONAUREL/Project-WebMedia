import type { Config } from 'drizzle-kit';
import * as dotenv from 'dotenv';
dotenv.config();

// Configuration pour Supabase (Main DB)
export default {
    schema: './src/db/supabase/schema.ts',
    out: './drizzle/supabase',
    driver: 'pg',
    dbCredentials: {
        connectionString: process.env.SUPABASE_DATABASE_URL || '',
    },
} satisfies Config;

// NOTE: Pour Neon, on lancera avec un autre fichier config ou via flag
// drizzle-kit push --config neon.config.ts
