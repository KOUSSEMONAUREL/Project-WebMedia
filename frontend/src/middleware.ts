import { defineMiddleware } from 'astro:middleware';

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline'; style-src-elem 'self' 'unsafe-inline' https:; img-src 'self' https: data: blob:; connect-src 'self' https:; font-src 'self' data: https:; frame-src 'self' https://challenges.cloudflare.com https://vsembed.ru https://vsembed.su https://vidsrcme.ru https://vidsrc.to https://www.2embed.cc; object-src 'none'; media-src 'self' https:; worker-src 'self' blob:; base-uri 'self'; form-action 'self'";

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
};

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();

  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(key)) {
      response.headers.set(key, value);
    }
  }

  return response;
});
