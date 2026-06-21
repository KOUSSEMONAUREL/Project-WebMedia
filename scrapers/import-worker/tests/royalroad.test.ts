import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

test('royalroad importer module loads', async () => {
  const mod = await import('../src/importers/royalroad');
  assert.ok(typeof mod.importRoyalRoad === 'function');
});

test('royalroad uses @fsoc/royalroadl-api', () => {
  const src = fs.readFileSync(path.join(DIR, '..', 'src', 'importers', 'royalroad.ts'), 'utf-8');
  assert.ok(src.includes("@fsoc/royalroadl-api"));
  assert.ok(src.includes("RoyalRoadAPI"));
  assert.ok(src.includes("getPopular"));
  assert.ok(src.includes("type: 'novel'"));
  assert.ok(src.includes("sourceSite: 'royalroad'"));
  assert.ok(src.includes("royalroad.com"));
});

test('royalroad imported in index.ts', () => {
  const src = fs.readFileSync(path.join(DIR, '..', 'src', 'index.ts'), 'utf-8');
  assert.ok(src.includes("importRoyalRoad"), 'importRoyalRoad imported');
  assert.ok(src.includes("royalroad.js"), 'imported from royaload.js');
  assert.ok(src.includes("RoyalRoad novels"), 'log message present');
});

test('@fsoc/royalroadl-api in package.json', async () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(DIR, '..', 'package.json'), 'utf-8')
  );
  assert.ok(pkg.dependencies['@fsoc/royalroadl-api'], 'dependency added');
});
