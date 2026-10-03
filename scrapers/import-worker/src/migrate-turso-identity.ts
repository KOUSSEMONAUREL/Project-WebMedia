/**
 * Applique la migration d'identite de jeu sur Turso.
 *
 * Turso est la base de LECTURE du site. Sans ses colonnes, le backfill echoue
 * en UPDATE et les champs n'arrivent jamais en production.
 *
 * SQLite ne supporte pas "ADD COLUMN IF NOT EXISTS": on teste donc l'existence
 * de chaque colonne avant de l'ajouter, ce qui rend le script idempotent.
 */
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || '';
const token = process.env.TURSO_AUTH_TOKEN || '';

const COLUMNS: [string, string][] = [
    ['game_type', 'integer'],
    ['parent_game_name', 'text'],
    ['version_parent_name', 'text'],
    ['official_url', 'text'],
    ['store_url', 'text'],
];

async function main() {
    if (!url || !token) {
        console.error('TURSO_DATABASE_URL / TURSO_AUTH_TOKEN absents');
        process.exitCode = 1;
        return;
    }
    const turso = createClient({ url, authToken: token });

    const { rows } = await turso.execute("PRAGMA table_info('medias')");
    const existing = new Set(rows.map((r: any) => r.name));

    let added = 0;
    for (const [name, type] of COLUMNS) {
        if (existing.has(name)) {
            console.log(`  ${name}: deja present`);
            continue;
        }
        await turso.execute(`ALTER TABLE medias ADD COLUMN ${name} ${type}`);
        console.log(`  ${name}: ajoute (${type})`);
        added++;
    }

    await turso.execute('CREATE INDEX IF NOT EXISTS medias_igdb_game_type_idx ON medias (game_type)');
    console.log(`Migration Turso terminee: ${added} colonne(s) ajoutee(s)`);
}

main().catch((e) => {
    console.error('Migration Turso en echec:', e?.message || e);
    process.exitCode = 1;
});
