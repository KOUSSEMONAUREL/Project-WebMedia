import 'dotenv/config';
import { createClient } from '@libsql/client';
import Database from 'better-sqlite3';
import { existsSync, unlinkSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const MANGADEX_API = 'https://api.mangadex.org';
const ANILIST_API = 'https://graphql.anilist.co';
const OPEN_LIBRARY_API = 'https://openlibrary.org';

const TURSO_URL = process.env.TURSO_DATABASE_URL!;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN!;
const B2_KEY_ID = process.env.B2_KEY_ID!;
const B2_APP_KEY = process.env.B2_APPLICATION_KEY!;
const B2_BUCKET_ID = process.env.B2_BUCKET_ID!;
const B2_BUCKET = process.env.B2_BUCKET!;
const B2_ENDPOINT = process.env.B2_ENDPOINT!;
const OUTPUT = join(process.cwd(), 'catalogue.sqlite');

if (!TURSO_URL) { console.error('TURSO_DATABASE_URL required'); process.exit(1); }

type Row = Record<string, any>;

const TYPE_MAP: Record<string, string> = {
  movie: 'film',
  game: 'jeu',
};

async function exportToSQLite() {
  console.log('[export] connecting to Turso...');
  const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

  console.log('[export] reading medias...');
  const medias = (await turso.execute('SELECT * FROM medias ORDER BY created_at')).rows as Row[];
  console.log(`  ${medias.length} medias`);

  console.log('[export] reading episodes...');
  const episodes = (await turso.execute('SELECT * FROM episodes ORDER BY media_id, season_number, episode_number')).rows as Row[];
  console.log(`  ${episodes.length} episodes`);

  console.log('[export] reading liens...');
  const liens = (await turso.execute('SELECT * FROM liens ORDER BY media_id')).rows as Row[];
  console.log(`  ${liens.length} liens`);

  turso.close();

  if (existsSync(OUTPUT)) unlinkSync(OUTPUT);

  const db = new Database(OUTPUT);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE medias (
      id TEXT PRIMARY KEY, external_id TEXT, type TEXT NOT NULL,
      title TEXT NOT NULL, original_title TEXT, slug TEXT NOT NULL UNIQUE,
      synopsis TEXT, year INTEGER, author TEXT, poster_url TEXT,
      backdrop_url TEXT, rating TEXT, vote_count INTEGER DEFAULT 0,
      status TEXT, tmdb_id INTEGER, imdb_id TEXT, anilist_id INTEGER,
      mal_id INTEGER, kitsu_id INTEGER, igdb_id INTEGER, anidb_id INTEGER,
      metadata_source TEXT DEFAULT 'tmdb', metadata_fresh_at INTEGER,
      links_last_scraped_at INTEGER, active_links_count INTEGER DEFAULT 0,
      created_at INTEGER, updated_at INTEGER,
      genres TEXT, trailer_url TEXT, duration INTEGER,
      tagline TEXT, studios TEXT, episode_count INTEGER
    );
    CREATE INDEX idx_medias_type ON medias(type);
    CREATE INDEX idx_medias_slug ON medias(slug);
    CREATE INDEX idx_medias_rating ON medias(CAST(rating AS REAL));

    CREATE TABLE episodes (
      id TEXT PRIMARY KEY,
      media_id TEXT NOT NULL REFERENCES medias(id) ON DELETE CASCADE,
      season_number INTEGER NOT NULL, episode_number INTEGER NOT NULL,
      title TEXT, synopsis TEXT, air_date INTEGER,
      thumbnail_url TEXT, duration INTEGER
    );
    CREATE INDEX idx_episodes_media ON episodes(media_id);

    CREATE TABLE liens (
      id TEXT PRIMARY KEY,
      media_id TEXT NOT NULL REFERENCES medias(id) ON DELETE CASCADE,
      episode_id TEXT REFERENCES episodes(id) ON DELETE CASCADE,
      source_site TEXT NOT NULL, player_host TEXT, url TEXT NOT NULL,
      quality TEXT, language TEXT, has_subtitles INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1, fail_count INTEGER DEFAULT 0,
      last_verified INTEGER, scraped_at INTEGER, headers TEXT
    );
    CREATE INDEX idx_liens_media ON liens(media_id);
  `);

  const insertMedia = db.prepare(`INSERT INTO medias VALUES (
    $id, $external_id, $type, $title, $original_title, $slug, $synopsis,
    $year, $author, $poster_url, $backdrop_url, $rating, $vote_count,
    $status, $tmdb_id, $imdb_id, $anilist_id, $mal_id, $kitsu_id,
    $igdb_id, $anidb_id, $metadata_source, $metadata_fresh_at,
    $links_last_scraped_at, $active_links_count, $created_at, $updated_at,
    $genres, $trailer_url, $duration, $tagline, $studios, $episode_count
  )`);

  const insertEpisode = db.prepare(`INSERT INTO episodes VALUES (
    $id, $media_id, $season_number, $episode_number, $title, $synopsis,
    $air_date, $thumbnail_url, $duration
  )`);

  const insertLien = db.prepare(`INSERT INTO liens VALUES (
    $id, $media_id, $episode_id, $source_site, $player_host, $url,
    $quality, $language, $has_subtitles, $is_active, $fail_count,
    $last_verified, $scraped_at, $headers
  )`);

  console.log('[export] inserting medias...');
  const insertAll = db.transaction(() => {
    for (const m of medias) {
      let posterUrl = m.poster_url;
      if (posterUrl && typeof posterUrl === 'string' && posterUrl.startsWith('http://books.google.com')) {
        posterUrl = posterUrl.replace('http://', 'https://');
      }
      insertMedia.run({
        id: m.id, external_id: m.external_id, type: TYPE_MAP[m.type] || m.type, poster_url: posterUrl,
        title: m.title, original_title: m.original_title, slug: m.slug,
        synopsis: m.synopsis, year: m.year, author: m.author,
        backdrop_url: m.backdrop_url,
        rating: m.rating, vote_count: m.vote_count ?? 0,
        status: m.status, tmdb_id: m.tmdb_id,
        imdb_id: m.imdb_id, anilist_id: m.anilist_id,
        mal_id: m.mal_id, kitsu_id: m.kitsu_id,
        igdb_id: m.igdb_id, anidb_id: m.anidb_id,
        metadata_source: m.metadata_source ?? 'tmdb',
        metadata_fresh_at: m.metadata_fresh_at,
        links_last_scraped_at: m.links_last_scraped_at,
        active_links_count: m.active_links_count ?? 0,
        created_at: m.created_at, updated_at: m.updated_at,
        genres: m.genres, trailer_url: m.trailer_url,
        duration: m.duration, tagline: m.tagline,
        studios: m.studios, episode_count: m.episode_count,
      });
    }
  });
  insertAll();
  console.log('  done');

  console.log('[export] inserting episodes...');
  const insertEpisodes = db.transaction(() => {
    for (const e of episodes) {
      insertEpisode.run({
        id: e.id, media_id: e.media_id,
        season_number: e.season_number, episode_number: e.episode_number,
        title: e.title, synopsis: e.synopsis,
        air_date: e.air_date, thumbnail_url: e.thumbnail_url,
        duration: e.duration,
      });
    }
  });
  insertEpisodes();
  console.log('  done');

  console.log('[export] inserting liens...');
  const insertLiens = db.transaction(() => {
    for (const l of liens) {
      insertLien.run({
        id: l.id, media_id: l.media_id, episode_id: l.episode_id,
        source_site: l.source_site, player_host: l.player_host,
        url: l.url, quality: l.quality, language: l.language,
        has_subtitles: l.has_subtitles ?? 0,
        is_active: l.is_active ?? 1, fail_count: l.fail_count ?? 0,
        last_verified: l.last_verified, scraped_at: l.scraped_at,
        headers: l.headers ? JSON.stringify(l.headers) : null,
      });
    }
  });
  insertLiens();
  console.log('  done');

  db.close();

  const size = statSync(OUTPUT).size;
  console.log(`[export] SQLite file: ${OUTPUT} (${Math.round(size / 1024 / 1024 * 100) / 100} MB)`);
  return OUTPUT;
}

async function deleteOldVersions(authToken: string, apiUrl: string) {
  console.log('[b2] listing old versions...');
  const listRes = await fetch(`${apiUrl}/b2api/v3/b2_list_file_versions`, {
    method: 'POST',
    headers: { Authorization: authToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: B2_BUCKET_ID, prefix: 'catalogue.sqlite' }),
  });
  if (!listRes.ok) return;
  const list = await listRes.json() as any;
  for (const f of (list.files || [])) {
    if (f.fileName === 'catalogue.sqlite') {
      console.log(`[b2] deleting old version: ${f.fileId}`);
      await fetch(`${apiUrl}/b2api/v3/b2_delete_file_version`, {
        method: 'POST',
        headers: { Authorization: authToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: f.fileName, fileId: f.fileId }),
      });
    }
  }
}

async function uploadToB2(filePath: string) {
  console.log('[b2] authorizing...');
  const basicAuth = Buffer.from(`${B2_KEY_ID}:${B2_APP_KEY}`).toString('base64');
  const authRes = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
    headers: { Authorization: `Basic ${basicAuth}` },
  });
  if (!authRes.ok) throw new Error(`B2 auth failed: ${authRes.status} ${await authRes.text()}`);
  const auth = await authRes.json() as any;
  const apiUrl = auth.apiInfo?.storageApi?.apiUrl || auth.apiUrl;
  const authToken = auth.authorizationToken;

  await deleteOldVersions(authToken, apiUrl);

  console.log('[b2] getting upload URL...');
  const uploadUrlRes = await fetch(`${apiUrl}/b2api/v3/b2_get_upload_url`, {
    method: 'POST',
    headers: { Authorization: authToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: B2_BUCKET_ID }),
  });
  if (!uploadUrlRes.ok) throw new Error(`B2 get upload URL failed: ${uploadUrlRes.status} ${await uploadUrlRes.text()}`);
  const uploadData = await uploadUrlRes.json() as any;
  const uploadUrl = uploadData.uploadUrl;
  const uploadAuthToken = uploadData.authorizationToken;

  console.log('[b2] uploading catalogue.sqlite...');
  const fileBuffer = readFileSync(filePath);
  const sha1 = createHash('sha1').update(fileBuffer).digest('hex');
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: uploadAuthToken, 'X-Bz-File-Name': 'catalogue.sqlite',
      'Content-Type': 'application/octet-stream', 'X-Bz-Content-Sha1': sha1,
      'Content-Length': String(fileBuffer.length),
    },
    body: fileBuffer,
  });
  if (!uploadRes.ok) throw new Error(`B2 upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  const result = await uploadRes.json() as any;
  console.log(`[b2] uploaded: ${result.fileName} (${result.fileId})`);
}

async function fillMissingCovers(db: any) {
  const missing = db.prepare(`SELECT id, type, title, author, external_id, metadata_source FROM medias WHERE poster_url IS NULL`).all() as any[];

  if (missing.length === 0) {
    console.log('[covers] all medias have poster_url, nothing to fill');
    return;
  }
  console.log(`[covers] filling ${missing.length} missing covers...`);

  const update = db.prepare(`UPDATE medias SET poster_url = ? WHERE id = ?`);

  for (const m of missing) {
    let url: string | null = null;

    if (m.metadata_source === 'mangadex' && m.external_id?.startsWith('mangadex-')) {
      const mdId = m.external_id.replace('mangadex-', '');
      url = await fetchMangaDexCover(mdId);
    }

    if (!url && (m.type === 'webtoon' || m.type === 'manga')) {
      url = await fetchAniListCover(m.title);
    }

    if (!url && m.type === 'book') {
      url = await fetchOpenLibraryCover(m.title, m.author);
    }

    if (url) {
      update.run(url, m.id);
      console.log(`  [cover] ${m.title} -> ${url}`);
    } else {
      console.log(`  [cover] no cover found for ${m.title} (${m.type}, ${m.metadata_source})`);
    }
  }
}

async function fetchMangaDexCover(mdId: string): Promise<string | null> {
  try {
    const res = await fetch(`${MANGADEX_API}/manga/${mdId}?includes[]=cover_art`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const coverRel = data.data?.relationships?.find((r: any) => r.type === 'cover_art');
    const fn = coverRel?.attributes?.fileName;
    if (fn) return `https://uploads.mangadex.org/covers/${mdId}/${fn}`;
    return null;
  } catch {
    return null;
  }
}

async function fetchAniListCover(title: string): Promise<string | null> {
  try {
    const query = `query($s: String) { Media(search: $s, type: MANGA) { coverImage { extraLarge } } }`;
    const res = await fetch(ANILIST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables: { s: title } }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data.data?.Media?.coverImage?.extraLarge || null;
  } catch {
    return null;
  }
}

async function fetchOpenLibraryCover(title: string, author?: string): Promise<string | null> {
  try {
    let q = title.replace(/^["']+|["']+$/g, '');
    q = q.replace(/^\d+\s*[\u2013\u2014\u002D]\s*/, '');
    q = q.split(' / ')[0];
    if (author && author !== 'Unknown') q += ' ' + author.split(',')[0];
    const res = await fetch(`${OPEN_LIBRARY_API}/search.json?q=${encodeURIComponent(q)}&limit=5`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const docs = data.docs || [];
    const best = docs.find((d: any) => d.title?.toLowerCase() === title.toLowerCase()) || docs[0];
    const coverI = best?.cover_i;
    if (coverI) return `https://covers.openlibrary.org/b/id/${coverI}-L.jpg`;
    return null;
  } catch {
    return null;
  }
}

async function main() {
  try {
    const filePath = await exportToSQLite();

    const fillDb = new Database(filePath);
    await fillMissingCovers(fillDb);
    fillDb.close();

    if (B2_KEY_ID && B2_APP_KEY && B2_BUCKET_ID) {
      await uploadToB2(filePath);
    } else {
      console.log('[export] B2 not configured, skipping upload');
    }
    console.log('[export] done');
  } catch (err) {
    console.error('[export] failed:', err);
    process.exit(1);
  }
}

main();
