import 'dotenv/config';
import postgres from 'postgres';

const DAY_MS = 24 * 3600 * 1000;

/**
 * Retention par statut terminal. Les durees sont alignees sur la fenetre glissante de 30 jours
 * que lit l'orchestrateur : purger un 'no_match' plus tot lui ferait perdre son poids dans
 * l'historique et le media retomberait a un intervalle d'un jour.
 *
 * Ce job purge des LIGNES, jamais des medias. Un echec de scrape (404, timeout, deploy casse)
 * ne prouve pas que la source a disparu, donc supprimer la fiche D1/Neon/Turso serait une perte
 * de donnees irreversible pour une simple panne technique. Les medias restent en base et
 * l'orchestrateur les espace (backoff) jusqu'a ce qu'ils repartent.
 */
const RETENTION_DAYS: Record<string, number> = {
    failed: 3,
    completed: 7,
    no_match: 30,
};

async function cleanup() {
    const dbUrl = process.env.SUPABASE_DATABASE_URL || '';
    if (!dbUrl) throw new Error('SUPABASE_DATABASE_URL missing');

    const sb = postgres(dbUrl, { prepare: false });

    // 1. Purge par statut, du plus court au plus long : si le job est interrompu en cours de
    // route, la table est deja bornee sur l'essentiel.
    for (const [status, days] of Object.entries(RETENTION_DAYS)) {
        const cutoff = new Date(Date.now() - days * DAY_MS);
        const deleted = await sb`
            DELETE FROM scraping_jobs
            WHERE status = ${status} AND updated_at < ${cutoff}
        `;
        console.log(`Supabase: ${deleted.count} '${status}' de plus de ${days}j supprimes`);
    }

    // 2. 'pending' / 'processing' ne doivent jamais trainer : on les signale sans les supprimer.
    // Un job bloque est un bug a traiter, pas une ligne a purger.
    const stale = await sb`
        SELECT status, count(*)::int AS n, min(updated_at) AS oldest
        FROM scraping_jobs
        WHERE status IN ('pending', 'processing')
        GROUP BY status
    `;
    for (const row of stale) {
        const oldest = row.oldest instanceof Date ? row.oldest.toISOString() : row.oldest;
        console.warn(`Stale ${row.status}: ${row.n} job(s), plus ancien ${oldest}`);
    }

    // 3. Etat final : la table doit rester bornee sur le free tier.
    const [total] = await sb`SELECT count(*)::int AS total FROM scraping_jobs`;
    console.log(`Supabase: ${total.total} scraping_jobs restants`);

    await sb.end();
    console.log('Cleanup done.');
    process.exit(0);
}

cleanup().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
});