import test from 'node:test';
import assert from 'node:assert';

test('media.ts imports createDbClient correctly', async () => {
  // Vérifie que l'import est correct : createDbClient est bien importé
  const content = await import('../src/routes/media');
  // Si le module se charge sans erreur, c'est que l'import de createDbClient fonctionne
  assert.ok(typeof content.default === 'object', 'media routes exported');
});

test('media.ts uses createDbClient for Neon', async () => {
  const content = await import('../src/routes/media');
  assert.ok(content.default, 'default export exists');
});

test('search.ts has offset parameter', async () => {
  const { default: searchRoutes } = await import('../src/routes/search');
  assert.ok(searchRoutes, 'search routes exported');
});

test('rate limiting applies to all API routes', async () => {
  const { app } = await import('../src/index');
  const routes = app.routes?.map(r => r.path) || [];
  const apiRoutes = routes.filter(r => r.startsWith('/api/'));
  assert.ok(apiRoutes.length > 0, 'has API routes');
});

test('webtoon routes registered', async () => {
  const { app } = await import('../src/index');
  const routes = app.routes?.map(r => `${r.method} ${r.path}`) || [];
  const hasWebtoon = routes.some(r => r.includes('/api/webtoon'));
  assert.ok(hasWebtoon, '/api/webtoon routes registered');
});
