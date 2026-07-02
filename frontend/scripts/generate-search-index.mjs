import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

var __dirname = dirname(fileURLToPath(import.meta.url));
var dbPath = resolve(__dirname, '../public/data/catalogue.sqlite');
var outPath = resolve(__dirname, '../public/data/search-index.json');

if (!existsSync(dbPath)) {
  console.warn('[search-index] catalogue.sqlite not found at', dbPath);
  writeFileSync(outPath, JSON.stringify([]));
  process.exit(0);
}

var Database = (await import('better-sqlite3')).default;
var db = new Database(dbPath, { readonly: true });

var rows = db.prepare(
  "SELECT id, title, type, slug, poster_url, year, rating FROM medias WHERE title IS NOT NULL AND title != '' ORDER BY CAST(rating AS REAL) DESC"
).all();

db.close();

var index = rows.map(function(r) {
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    slug: r.slug,
    posterUrl: r.poster_url || undefined,
    year: r.year || undefined,
    rating: r.rating !== null ? parseFloat(r.rating) : undefined,
  };
});

writeFileSync(outPath, JSON.stringify(index));
console.log('[search-index] generated ' + index.length + ' entries -> ' + outPath);
