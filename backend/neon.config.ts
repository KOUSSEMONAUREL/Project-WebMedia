import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';
dotenv.config();

// Configuration pour Neon (Catalogue DB)
export default defineConfig({
    schema: './src/db/neon/schema.ts',
    out: './drizzle/neon',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.NEON_DATABASE_URL || '',
    },
});
