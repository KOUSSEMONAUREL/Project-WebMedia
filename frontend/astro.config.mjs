import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const PUBLIC_DATA = join(process.cwd(), 'public', 'data');

function catalogueIntegration() {
    return {
        name: 'catalogue-downloader',
        hooks: {
            'astro:build:start': async () => {
                if (!existsSync(PUBLIC_DATA)) mkdirSync(PUBLIC_DATA, { recursive: true });
                const catalogPath = join(PUBLIC_DATA, 'catalogue.sqlite');
                const downloaded = existsSync(catalogPath);
                if (!downloaded) {
                    const B2_KEY_ID = process.env.B2_KEY_ID;
                    const B2_APP_KEY = process.env.B2_APPLICATION_KEY;
                    const B2_BUCKET = process.env.B2_BUCKET || 'Webmedia-backblaze';
                    if (B2_KEY_ID && B2_APP_KEY) {
                        console.log('[catalogue] downloading from B2...');
                        try {
                            const basicAuth = Buffer.from(`${B2_KEY_ID}:${B2_APP_KEY}`).toString('base64');
                            const authRes = await fetch(`${process.env.B2_API_ENDPOINT || 'https://api.backblazeb2.com'}/b2api/v3/b2_authorize_account`, {
                                headers: { Authorization: `Basic ${basicAuth}` },
                            });
                            if (authRes.ok) {
                                const auth = await authRes.json();
                                const dlBase = auth.apiInfo?.storageApi?.downloadUrl || auth.downloadUrl;
                                const dlUrl = `${dlBase}/file/${B2_BUCKET}/catalogue.sqlite`;
                                const fileRes = await fetch(dlUrl, {
                                    headers: { Authorization: auth.authorizationToken },
                                });
                                if (fileRes.ok) {
                                    const buffer = Buffer.from(await fileRes.arrayBuffer());
                                    writeFileSync(catalogPath, buffer);
                                    console.log(`[catalogue] downloaded (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
                                } else {
                                    console.warn(`[catalogue] B2 download failed: ${fileRes.status}`);
                                }
                            } else {
                                console.warn(`[catalogue] B2 auth failed: ${authRes.status}`);
                            }
                        } catch (err) {
                            console.warn('[catalogue] B2 download error:', err);
                        }
                    }
                    if (!existsSync(catalogPath)) {
                        console.log('[catalogue] creating empty placeholder');
                        writeFileSync(catalogPath, Buffer.alloc(0));
                    }
                }

                // Generate search index from catalogue
                const indexOut = join(PUBLIC_DATA, 'search-index.json');
                if (existsSync(catalogPath) && (await import('fs')).statSync(catalogPath).size > 0) {
                    try {
                        const { default: Database } = await import('better-sqlite3');
                        const db = new Database(catalogPath, { readonly: true });
                        const rows = db.prepare(
                            "SELECT id, title, type, slug, poster_url, year, rating FROM medias WHERE title IS NOT NULL AND title != '' ORDER BY CAST(rating AS REAL) DESC"
                        ).all();
                        db.close();
                        const index = rows.map(function (r) {
                            return {
                                id: r.id,
                                title: r.title,
                                type: r.type,
                                slug: r.slug,
                                posterUrl: r.poster_url || undefined,
                                year: r.year || undefined,
                                rating: r.rating !== null ? parseFloat(r.rating) : undefined,
                            };
                        });
                        writeFileSync(indexOut, JSON.stringify(index));
                        console.log('[search-index] generated ' + index.length + ' entries');
                    } catch (err) {
                        console.warn('[search-index] generation failed:', err);
                        writeFileSync(indexOut, JSON.stringify([]));
                    }
                } else {
                    writeFileSync(indexOut, JSON.stringify([]));
                    console.warn('[search-index] catalogue empty or missing, index is []');
                }
            },
        },
    };
}

export default defineConfig({
    integrations: [react(), catalogueIntegration()],
    output: 'static',
    vite: {
        plugins: [tailwindcss()],
        optimizeDeps: {
            include: ['react-dom/client'],
            exclude: ['better-sqlite3', 'sql.js'],
        },
        ssr: {
            noExternal: ['sql.js'],
            external: ['better-sqlite3'],
        },
        build: {
            rollupOptions: {
                external: ['better-sqlite3'],
            },
        },
    },
});
