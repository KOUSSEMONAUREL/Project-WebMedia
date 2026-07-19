import { defineMiddleware } from 'astro:middleware';

let cfEnv: any = {};
try {
  cfEnv = await import('cloudflare:workers');
} catch {}

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https: http:; style-src 'self' 'unsafe-inline'; style-src-elem 'self' 'unsafe-inline' https:; img-src 'self' https: http: data: blob:; connect-src 'self' https: http:; font-src 'self' data: https:; frame-src 'self' https://challenges.cloudflare.com https://vsembed.ru https://vsembed.su https://vidsrcme.ru https://vidsrc.to https://www.2embed.cc https://*.effectivecpmnetwork.com; object-src 'none'; media-src 'self' https: http:; worker-src 'self' blob:; base-uri 'self'; form-action 'self'";

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
};

export const onRequest = defineMiddleware(async (context, next) => {
  if (cfEnv?.env?.BACKEND) {
    (globalThis as any).__BACKEND = cfEnv.env.BACKEND;
  }

  try {
    const response = await next();

    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      if (!response.headers.has(key)) {
        response.headers.set(key, value);
      }
    }

    return response;
  } catch (err) {
    console.error('[MW] ERROR', context.request.url, err);
    return new Response('Internal Server Error', { status: 500 });
  }
});
