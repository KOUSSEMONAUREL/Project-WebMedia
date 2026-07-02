import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { cpSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const PUBLIC_DATA = join(process.cwd(), 'public', 'data');

export default defineConfig({
    integrations: [react()],
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
    build: {
        hooks: {
            'build:init': async () => {
                if (!existsSync(PUBLIC_DATA)) mkdirSync(PUBLIC_DATA, { recursive: true });
                const catalogPath = join(PUBLIC_DATA, 'catalogue.sqlite');
                if (!existsSync(catalogPath)) {
                    const B2_KEY_ID = process.env.B2_KEY_ID;
                    const B2_APP_KEY = process.env.B2_APPLICATION_KEY;
                    const B2_BUCKET = process.env.B2_BUCKET || 'Webmedia-backblaze';
                    if (B2_KEY_ID && B2_APP_KEY) {
                        console.log('[build] downloading catalogue.sqlite from B2...');
                        try {
                            const basicAuth = Buffer.from(`${B2_KEY_ID}:${B2_APP_KEY}`).toString('base64');
                            const authRes = await fetch(`${process.env.B2_API_ENDPOINT || 'https://api.backblazeb2.com'}/b2api/v3/b2_authorize_account`, {
                                headers: { Authorization: `Basic ${basicAuth}` },
                            });
                            if (authRes.ok) {
                                const auth = await authRes.json();
                                const apiInfo = auth.apiInfo;
                                const dlBase = apiInfo?.storageApi?.downloadUrl || auth.downloadUrl;
                                const dlUrl = `${dlBase}/file/${B2_BUCKET}/catalogue.sqlite`;
                                const fileRes = await fetch(dlUrl, {
                                    headers: { Authorization: auth.authorizationToken },
                                });
                                if (fileRes.ok) {
                                    const buffer = Buffer.from(await fileRes.arrayBuffer());
                                    const { writeFileSync } = await import('fs');
                                    writeFileSync(catalogPath, buffer);
                                    console.log(`[build] downloaded catalogue.sqlite (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
                                    return;
                                }
                                console.warn(`[build] B2 download failed: ${fileRes.status}`);
                            } else {
                                console.warn(`[build] B2 auth failed: ${authRes.status}`);
                            }
                        } catch (err) {
                            console.warn('[build] B2 download error:', err);
                        }
                    }
                    console.log('[build] no catalogue.sqlite, creating empty placeholder');
                    const { writeFileSync } = await import('fs');
                    writeFileSync(catalogPath, Buffer.alloc(0));
                }
            },
        },
    },
});
