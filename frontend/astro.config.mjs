import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'url';

const isCloudflare = !!(process.env.CF_PAGES || process.env.WORKERS_CI) || (process.env.VERCEL !== '1' && process.env.npm_lifecycle_event === 'build');

const adapter = isCloudflare
  ? (await import('@astrojs/cloudflare')).default()
  : (await import('@astrojs/vercel')).default();

export default defineConfig({
    site: 'https://www.webmediia.cfd',
    integrations: [react(), sitemap({
        filter: (page) => !page.includes('/admin') && !page.includes('/reset-password') && !page.includes('/verify-success'),
        changefreq: 'daily',
        priority: 0.7,
        lastmod: new Date(),
    })],
    output: 'server',
    adapter,
    vite: {
        resolve: {
            alias: isCloudflare ? {} : {
                'cloudflare:workers': fileURLToPath(new URL('src/lib/cloudflare-env.ts', import.meta.url)),
            },
        },
        build: {
            rollupOptions: {
                external: isCloudflare ? ['cloudflare:workers'] : [],
            },
        },
        plugins: [
            tailwindcss(),
            VitePWA({
                registerType: 'autoUpdate',
                includeAssets: ['favicon.ico'],
                manifest: {
                    name: 'WebMedia',
                    short_name: 'WebMedia',
                    description: 'Catalogue de films, series, animes, jeux, webtoons, livres et novels',
                    theme_color: '#0a0a0f',
                    background_color: '#0a0a0f',
                    display: 'standalone',
                    start_url: '/',
                    icons: [
                        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
                    ],
                },
                workbox: {
                    globPatterns: ['**/*.{js,css,html,svg,png,jpg,webp}'],
                },
            }),
        ],
        optimizeDeps: {
            include: ['react-dom/client'],
        },
    },
});
