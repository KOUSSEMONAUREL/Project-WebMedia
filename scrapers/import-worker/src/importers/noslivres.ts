import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq } from 'drizzle-orm';

const NOSLIVRES_URL = 'http://efele.net/ebooks/efele_catalogue_commun.txt';

export async function importNosLivres(databaseUrl: string, maxCount: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting NosLivres.net Massive Import...`);

    try {
        const response = await axios.get(NOSLIVRES_URL, { responseType: 'arraybuffer' });
        const text = new TextDecoder('utf-16be').decode(Buffer.from(response.data));
        const lines = text.split('\n');

        const existingSlugs = new Set(
            (await db.select({ slug: medias.slug }).from(medias).where(eq(medias.metadataSource, 'noslivres')))
                .map(r => r.slug)
        );
        console.log(`📦 ${existingSlugs.size} déjà en base, analyse du catalogue...`);

        const newEntries: { titre: string; auteur: string; url: string; slug: string }[] = [];

        for (let i = 1; i < lines.length; i++) {
            if (newEntries.length >= maxCount) break;
            const parts = lines[i].split('\t');
            if (parts.length < 3) continue;

            const [auteur, titre, url] = parts;
            if (!titre || !url) continue;

            const slug = `book-nl-${titre.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '')}`.substring(0, 490);
            if (!existingSlugs.has(slug)) {
                newEntries.push({ titre, auteur, url, slug });
            }
        }

        let importedCount = 0;
        for (const entry of newEntries) {
            try {
                const [media] = await db.insert(medias).values({
                    type: 'novel',
                    title: entry.titre,
                    originalTitle: entry.titre,
                    synopsis: `Auteur: ${entry.auteur}`,
                    slug: entry.slug,
                    metadataSource: 'noslivres',
                    metadataFreshAt: new Date()
                }).returning({ id: medias.id });

                if (media) {
                    await db.insert(liens).values({
                        mediaId: media.id,
                        sourceSite: 'noslivres',
                        url: entry.url,
                        quality: 'original',
                        language: 'FR'
                    });
                    importedCount++;
                }
            } catch { }
        }

        console.log(`✅ NosLivres.net import complete: ${importedCount} added.`);
    } catch (error: any) {
        console.error('❌ NosLivres.net Import Error:', error.message);
    }
}
