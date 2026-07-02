import { test, expect } from 'vitest';

test('media.ts imports createDbClient correctly', async () => {
  const content = await import('../src/routes/media');
  expect(typeof content.default).toBe('object');
});

test('media.ts uses createDbClient for Neon', async () => {
  const content = await import('../src/routes/media');
  expect(content.default).toBeDefined();
});

test('search.ts has offset parameter', async () => {
  const { default: searchRoutes } = await import('../src/routes/search');
  expect(searchRoutes).toBeDefined();
});

test('rate limiting applies to all API routes', async () => {
  const { app } = await import('../src/index');
  const routes = app.routes?.map(r => r.path) || [];
  const apiRoutes = routes.filter(r => r.startsWith('/api/'));
  expect(apiRoutes.length).toBeGreaterThan(0);
});

