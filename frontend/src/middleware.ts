import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https: http:; style-src 'self' 'unsafe-inline'; style-src-elem 'self' 'unsafe-inline' https:; img-src 'self' https: http: data: blob:; connect-src 'self' https: http:; font-src 'self' data: https:; frame-src 'self' https://challenges.cloudflare.com https://vsembed.ru https://vsembed.su https://vidsrcme.ru https://vidsrc.to https://www.2embed.cc https://*.effectivecpmnetwork.com; object-src 'none'; media-src 'self' https: http:; worker-src 'self' blob:; base-uri 'self'; form-action 'self'";

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
};

export const onRequest = defineMiddleware(async (_, next) => {
  if (env?.BACKEND) (globalThis as any).__BACKEND = env.BACKEND;

  const response = await next();

  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(key)) {
      response.headers.set(key, value);
    }
  }

  return response;
});
