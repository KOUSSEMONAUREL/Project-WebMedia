import 'dotenv/config';
import postgres from 'postgres';

const DAY_MS = 24 * 3600 * 1000;

/**
 * Retention par statut. La regle : une duree de purge doit toujours couvrir la fenetre
 * d'analyse de l'orchestrateur (30 jours), sinon le compteur d'echecs se vide sous ses pieds
 * et le seuil de retrait ne peut jamais etre atteint.
 *
 * - 'failed' et 'no_match' doivent SURPASSER la fenetre, jamais l'egaler : un media
 *   atteint le seuil de retrait a 5 echecs permanents, donc il doit pouvoir en
 *   compter 5 dans la fenetre. A 30j exactement, purge et analyse tombaient le meme
 *   jour, et la purge pouvait emporter la derniere ligne avant le comptage -- le media
 *   repartait alors pour 5 cycles de plus. On garde 35j, un cycle de marge au-dela
 *   des 30j de fenetre.
 * - 'completed' part a 7j : jamais lu par l'orchestrateur (un succes ne compte pas comme un
 *   echec), c'est du bruit, et c'est lui qui ferait grossir la table sur le free tier.
 *
 * Ce job purge des LIGNES, jamais des medias. Un echec de scrape (404, timeout, deploy casse)
 * ne prouve pas que la source a disparu : supprimer la fiche D1/Neon/Turso serait une perte
 * irreversible pour une simple panne technique. Le media reste et l'orchestrateur l'espace.
 */
const RETENTION_DAYS: Record<string, number> = {
    completed: 7,
    failed: 35,
    no_match: 35,
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