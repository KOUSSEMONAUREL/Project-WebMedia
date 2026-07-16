import { defineMiddleware } from 'astro:middleware';

const SECURITY_HEADERS: Record<string, string> = {};

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();

  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(key)) {
      response.headers.set(key, value);
    }
  }

  return response;
});
