import { defineMiddleware } from 'astro:middleware';

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://quge5.com https://*.effectivecpmnetwork.com https://elderlygoal.com; style-src 'self' 'unsafe-inline'; style-src-elem 'self' 'unsafe-inline' https://api.fontshare.com; img-src 'self' https: data: blob:; connect-src 'self' https://webmedia-backend.koussemonaurel.workers.dev https://project-webmedia.onrender.com https://challenges.cloudflare.com; font-src 'self' data: https://api.fontshare.com; frame-src 'self' https://challenges.cloudflare.com; object-src 'none'; media-src 'self' https:; worker-src 'self' blob:; base-uri 'self'; form-action 'self'";

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
};

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();

  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(key)) {
      response.headers.set(key, value);
    }
  }

  return response;
});
