import { createClient } from "@libsql/client";
import pg from "pg";

const { Pool } = pg;

export async function syncNeonToTurso(env: any) {
    console.log("🔄 Starting Neon -> Turso Sync...");
    const neonPool = new Pool({ connectionString: env.NEON_DATABASE_URL });
    const turso = createClient({
        url: env.TURSO_DATABASE_URL,
        authToken: env.TURSO_AUTH_TOKEN,
    });

    // Advisory lock PostgreSQL (évite les exécutions concurrentes sans Redis)
    const lockClient = new Pool({ connectionString: env.NEON_DATABASE_URL, max: 1 });
    try {
        const { rows: lockResult } = await lockClient.query("SELECT pg_try_advisory_lock(942389423) AS locked");
        if (!lockResult[0]?.locked) {
            console.warn("⚠️ Sync already in progress (advisory lock held), skipping...");
            return;
        }
    } finally {
        await lockClient.end();
    }

    try {
        const { rows: medias } = await neonPool.query("SELECT * FROM medias");
        console.log(`📦 Syncing ${medias.length} medias...`);

        for (const media of medias) {
            await turso.execute({
                sql: `INSERT INTO medias (id, type, title, synopsis, year, poster_url, rating, vote_count)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT(id) DO UPDATE SET
                        title = excluded.title,
                        synopsis = excluded.synopsis,
                        poster_url = excluded.poster_url,
                        rating = excluded.rating`,
                args: [
                    media.id, media.type, media.title, media.synopsis,
                    media.year, media.poster_url, media.rating, media.vote_count
                ]
            });
        }

        console.log("✅ Sync Complete!");
    } catch (e) {
        console.error("❌ Sync Error:", e);
    } finally {
        await neonPool.end();
    }
}
