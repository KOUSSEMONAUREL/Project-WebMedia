import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    integrations: [react()],
    output: 'static',
    adapter: vercel(),
    vite: {
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
                    runtimeCaching: [
                        {
                            urlPattern: /^https?:\/\/webmedia-backend\.koussemonaurel\.workers\.dev\/api\/.*/i,
                            handler: 'CacheFirst',
                            options: {
                                cacheName: 'api-cache',
                                expiration: { maxEntries: 50, maxAgeSeconds: 300 },
                            },
                        },
                    ],
                },
            }),
        ],
        optimizeDeps: {
            include: ['react-dom/client'],
        },
    },
});