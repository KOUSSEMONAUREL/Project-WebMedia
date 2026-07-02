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
                if (existsSync(catalogPath)) return;
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
                                return;
                            }
                            console.warn(`[catalogue] B2 download failed: ${fileRes.status}`);
                        } else {
                            console.warn(`[catalogue] B2 auth failed: ${authRes.status}`);
                        }
                    } catch (err) {
                        console.warn('[catalogue] B2 download error:', err);
                    }
                }
                console.log('[catalogue] creating empty placeholder');
                writeFileSync(catalogPath, Buffer.alloc(0));
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
