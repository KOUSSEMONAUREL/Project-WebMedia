/**
 * Propage le parent IGDB vers les jobs de scraping deja en file.
 *
 * L'orchestrateur renseigne parent_game_name a la creation d'un job, mais les
 * jobs crees avant le backfill d'identite l'ont a NULL. Sans ce parent, le
 * matcher ne peut pas distinguer "Doom" de "Doom Eternal" ni accepter un alias
 * designe par IGDB: il ne voit que le titre du media.
 *
 * Neon (medias.parent_game_name) et Supabase (scraping_jobs) sont deux bases
 * distinctes: on lit d'un cote, on ecrit de l'autre.
 */
import postgres from 'postgres';
import { createLog } from './utils/log.js';

const log = createLog('propagate-job-parents');

/** Requetes en vol vers Supabase. */
const CONCURRENCY = 16;

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (cursor < items.length) {
                await fn(items[cursor++]);
            }
        })
    );
}

async function main() {
    const neonUrl = process.env.NEON_DATABASE_URL || '';
    const supabaseUrl =
        process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_TRANSACTION_POOLER || '';

    if (!neonUrl || !supabaseUrl) {
        log.error('Configuration incomplete (NEON_DATABASE_URL / SUPABASE_DATABASE_URL)');
        process.exitCode = 1;
        return;
    }

    const neon = postgres(neonUrl, { ssl: 'require', max: 2, connect_timeout: 20 });
    const supabase = postgres(supabaseUrl, { ssl: 'require', max: 2, connect_timeout: 20 });

    try {
        const pending = await supabase`
            SELECT DISTINCT media_id::text AS media_id
            FROM scraping_jobs
            WHERE status = 'pending'
        `;
        const mediaIds: string[] = pending.map((r: any) => r.media_id);
        log.info(`${mediaIds.length} medias en attente`);
        if (mediaIds.length === 0) return;

        // Les parents viennent de Neon, par lots pour rester sous la limite de
        // parametres d'une seule requete.
        //
        // COALESCE indispensable: IGDB ne met pas le jeu de base dans la meme
        // colonne selon le jeu. "Shadow of the Erdtree" (game_type 3) le range
        // dans version_parent, "Elden Ring" lui-meme dans parent_game. Sans ce
        // repli, 146 extensions n'avaient aucun parent et le matcher rattachait
        // les liens du jeu de base.
        const parents = new Map<string, string>();
        for (let i = 0; i < mediaIds.length; i += 400) {
            const slice = mediaIds.slice(i, i + 400);
            const rows = await neon`
                SELECT id::text AS id,
                       COALESCE(parent_game_name, version_parent_name) AS parent
                FROM medias
                WHERE id::text IN ${neon(slice)}
                  AND COALESCE(parent_game_name, version_parent_name) IS NOT NULL
            `;
            for (const r of rows as any[]) parents.set(String(r.id), r.parent);
        }
        log.info(`${parents.size} medias ont un parent IGDB`);

        let touched = 0;
        await pool(mediaIds, CONCURRENCY, async (mediaId: string) => {
            const parent = parents.get(mediaId) || null;
            // IS DISTINCT FROM ecrit aussi les NULL, pour ne pas laisser un
            // parent perime sur un job qui aurait change de jeu.
            const res = await supabase`
                UPDATE scraping_jobs
                SET parent_game_name = ${parent}, updated_at = now()
                WHERE media_id::text = ${mediaId}
                  AND status = 'pending'
                  AND parent_game_name IS DISTINCT FROM ${parent}
            `;
            touched += res.count || 0;
        });

        const withParent = await supabase`
            SELECT count(*)::int AS n FROM scraping_jobs
            WHERE status = 'pending' AND parent_game_name IS NOT NULL
        `;
        log.success(
            `Termine: ${touched} job(s) ecrit(s), ${withParent[0].n} job(s) pending avec parent`
        );
    } finally {
        await neon.end();
        await supabase.end();
    }
}

main().catch((e) => {
    log.error(`Echec: ${e?.message || e}`);
    process.exitCode = 1;
});