import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src', 'index.ts');

test('cheerio-worker has streaming sources', () => {
  const src = fs.readFileSync(SRC, 'utf-8');
  assert.ok(src.includes('vidsrc.me'));
  assert.ok(src.includes('vidsrc.to'));
  assert.ok(src.includes('2embed.cc'));
  assert.ok(src.includes('embed.su'));
  assert.ok(src.includes('multiembed'));
  assert.ok(src.includes('vidsrc.icu'));
  const matches = src.match(/name:/g);
  assert.ok(matches && matches.length >= 6, 'at least 6 streaming sources');
});

test('cheerio-worker imports webtoon pipeline', () => {
  const src = fs.readFileSync(SRC, 'utf-8');
  assert.ok(src.includes('webtoons'), 'imports from webtoons');
  assert.ok(src.includes('processMedia'), 'uses processMedia');
});

test('cheerio-worker handles all media types', () => {
  const src = fs.readFileSync(SRC, 'utf-8');
  assert.ok(src.includes("['webtoon', 'comic', 'manga']"), 'handles webtoon/comic/manga');
  assert.ok(src.includes("['film', 'serie', 'anime']"), 'handles film/serie/anime');
  assert.ok(src.includes("mediaType === 'book'"), 'handles book');
});

test('old vidsrc-worker is deprecated', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'import-worker', 'src', 'vidsrc-worker.ts'),
    'utf-8'
  );
  assert.ok(src.includes('@deprecated'));
  assert.ok(src.includes('cheerio-worker'));
});

test('orchestrator dispatches all worker types', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'backend', 'src', 'services', 'orchestrator.ts'),
    'utf-8'
  );
  assert.ok(src.includes("'playwright'"));
  assert.ok(src.includes("'novel'"));
  assert.ok(src.includes("'cheerio'"));
  assert.ok(!src.includes("'cheerio' : 'cheerio'"), 'not just cheerio fallback');
});
