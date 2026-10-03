/**
 * Diagnostic: pourquoi IGDB ne renvoie-t-il pas tous les ids demandes ?
 * Compare le nombre d'ids demands au nombre de jeux reellement renvoyes, et
 * affiche un echantillon brut. Lance avec: node dist/probe-igdb.js [nbIds]
 */
import axios from 'axios';
import { sql } from 'drizzle-orm';
import { createNeonClient } from './db/client.js';
import { medias } from './db/neon/schema.js';

const FIELDS = 'fields id,name,game_type,parent_game.name,version_parent.name,websites.url,websites.type';

async function main() {
    const N = parseInt(process.argv[2] || '40', 10);
    const neon = createNeonClient(process.env.NEON_DATABASE_URL || '');

    const tok = await axios.post(
        'https://id.twitch.tv/oauth2/token',
        null,
        {
            params: {
                client_id: process.env.TWITCH_CLIENT_ID,
                client_secret: process.env.TWITCH_CLIENT_SECRET,
                grant_type: 'client_credentials',
            },
            timeout: 20000,
        }
    );
    const token = tok.data.access_token;
    console.log('token obtenu');

    const rows = await neon.select({ igdbId: medias.igdbId, title: medias.title })
        .from(medias)
        .where(sql`type = 'jeu' AND igdb_id IS NOT NULL AND (game_type IS NULL OR official_url IS NULL) ORDER BY igdb_id ASC LIMIT ${N}`);

    const ids = rows.map((r: any) => r.igdbId);
    console.log(`ids demandes : ${ids.length}`);

    // Teste plusieurs tailles de lot: IGDB plafonne le nombre d'ids acceptes
    // dans une clause "where id = (...)".
    for (const size of [40, 20, 10]) {
        const slice = ids.slice(0, size);
        const body = `${FIELDS}; where id = (${slice.join(',')});`;
        const r = await axios.post('https://api.igdb.com/v4/games', body, {
            headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${token}` },
            timeout: 25000,
        });
        const data = r.data || [];
        console.log(`lot de ${String(size).padStart(2)} : ${data.length} reponse(s)`);
    }

    const body = `${FIELDS}; where id = (${ids.join(',')});`;
    const r = await axios.post('https://api.igdb.com/v4/games', body, {
        headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${token}` },
        timeout: 25000,
    });
    const data = r.data || [];
    const returned = new Set(data.map((g: any) => g.id));
    const missing = ids.filter((i: number) => !returned.has(i));
    console.log(`reponses (lot 40) : ${data.length} | manquants : ${missing.length}`);

    if (missing.length > 0) {
        const byId = new Map(rows.map((x: any) => [x.igdbId, x.title]));
        console.log('premiers absents (id -> titre en base):');
        missing.slice(0, 8).forEach((i: number) => console.log(`   ${i} -> ${byId.get(i)}`));
    }

    console.log('echantillon brut d\'un jeu renvoye :');
    console.log(JSON.stringify(data[0] || null, null, 2).slice(0, 900));
}

main().catch((e) => {
    console.error('probe en echec:', e?.response?.status, e?.message?.slice(0, 200));
    process.exitCode = 1;
});
