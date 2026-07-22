import test from 'node:test';
import assert from 'node:assert';

test('novel worker uses LNCRAWL_PATH env var', async () => {
  const content = await import('../src/index');
  assert.ok(content, 'module loads');
});

test('novel worker no longer hardcodes absolute path', async () => {
  // Vérifie que le code source n'a plus le path hardcodé
  const fs = await import('fs');
  const source = fs.readFileSync(
    new URL('../src/index.ts', import.meta.url),
    'utf-8'
  );
  assert.ok(
    !source.includes('/home/aurel/CODE/Project-WebMediia/scrapers/playwright-worker/venv/bin/lncrawl'),
    'hardcoded path removed from index.ts'
  );
  assert.ok(
    source.includes("process.env.LNCRAWL_PATH || 'lncrawl'"),
    'uses LNCRAWL_PATH env var with lncrawl fallback'
  );
});

test('novel worker CI has python + pip install lncrawl', async () => {
  const fs = await import('fs');
  const ci = fs.readFileSync(
    new URL('../../../.github/workflows/novel-scraper.yml', import.meta.url),
    'utf-8'
  );
  assert.ok(ci.includes('setup-python'), 'Python setup step exists');
  assert.ok(ci.includes('pip install lightnovel-crawler'), 'pip install lightnovel-crawler step exists');
  assert.ok(ci.includes('LNCRAWL_PATH'), 'LNCRAWL_PATH env var set in CI');
});
