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
  assert.ok(src.includes('multiembed'));
  assert.ok(src.includes('vidsrc.icu'));
  assert.ok(src.includes('ezvidapi'));
  const matches = src.match(/name:/g);
  assert.ok(matches && matches.length >= 7, 'at least 7 streaming sources');
});

test('cheerio-worker handles streaming media types', () => {
  const src = fs.readFileSync(SRC, 'utf-8');
  assert.ok(src.includes("['film', 'movie', 'serie', 'anime']"), 'handles film/movie/serie/anime');
});

test('cheerio-worker resolves tmdb for anime via backend', () => {
  const src = fs.readFileSync(SRC, 'utf-8');
  assert.ok(src.includes('/resolve/tmdb'), 'uses tmdb resolve endpoint');
  assert.ok(src.includes('anilist_id'), 'looks up by anilist_id');
});

test('cheerio-worker generates episode-specific URLs for TV', () => {
  const src = fs.readFileSync(SRC, 'utf-8');
  assert.ok(src.includes('season_number'), 'queries episodes with season_number');
  assert.ok(src.includes('episode_number'), 'queries episodes with episode_number');
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
