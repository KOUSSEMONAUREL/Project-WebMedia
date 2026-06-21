import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq } from 'drizzle-orm';

const NOSLIVRES_URL = 'http://efele.net/ebooks/efele_catalogue_commun.txt';

export async function importNosLivres(databaseUrl: string) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting NosLivres.net Massive Import...`);

    try {
        // IMPORTANT: Téléchargement en arraybuffer pour gérer manuellement l'encodage
        const response = await axios.get(NOSLIVRES_URL, { responseType: 'arraybuffer' });
        
        // Le fichier semble être en UTF-16LE, on le convertit
        const text = Buffer.from(response.data).toString('utf16le');
        const lines = text.split('\n');
        
        let importedCount = 0;
        
        // i = 1 pour sauter la ligne d'en-tête (Auteur\tTitre\tURL...)
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            const parts = line.split('\t');
            
            // On s'assure qu'on a bien nos colonnes
            if (parts.length < 3) continue;

            const [auteur, titre, url] = parts;
            if (!titre || !url) continue;

            const slug = `book-nl-${titre.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '')}`.substring(0, 490);
            
            const existing = await db.select().from(medias).where(eq(medias.slug, slug)).limit(1);

            if (existing.length === 0) {
                const [media] = await db.insert(medias).values({
                    type: 'novel',
                    title: titre,
                    originalTitle: titre,
                    synopsis: `Auteur: ${auteur}`,
                    slug,
                    metadataSource: 'noslivres',
                    metadataFreshAt: new Date()
                }).returning({ id: medias.id });

                if (media) {
                    await db.insert(liens).values({
                        mediaId: media.id,
                        sourceSite: 'noslivres',
                        url: url,
                        quality: 'original',
                        language: 'FR'
                    });
                    importedCount++;
                }
            }
        }
        console.log(`✅ NosLivres.net import complete: ${importedCount} added.`);
    } catch (error: any) {
        console.error('❌ NosLivres.net Import Error:', error.message);
    }
}
