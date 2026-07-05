-- Schéma pour Cloudflare D1 (Données statiques et de référence)

-- Genres
CREATE TABLE IF NOT EXISTS genres (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL, -- film, serie, anime, etc.
    tmdb_id INTEGER
);

-- Plateformes (Streaming/Achat)
CREATE TABLE IF NOT EXISTS plateformes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    logo_url TEXT,
    url TEXT,
    type TEXT -- stream, buy, rent
);

-- Pays
CREATE TABLE IF NOT EXISTS pays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE, -- FR, US, JP...
    nom TEXT NOT NULL
);

-- État de chaque média côté pipeline (Le CERVEAU)
CREATE TABLE IF NOT EXISTS media_state (
  media_id        TEXT PRIMARY KEY,  -- même ID UUID que Neon
  type            TEXT,              -- film/serie/anime/manga/jeu
  title           TEXT,              -- titre (fallback si Neon indisponible)
  slug            TEXT,              -- slug (fallback si Neon indisponible)
  has_content     INTEGER DEFAULT 0, -- 1 si au moins 1 lien actif vérifié
  metadata_ok     INTEGER DEFAULT 0, -- 1 si métadonnées complètes
  active_links    INTEGER DEFAULT 0, -- compte mis à jour après chaque cycle
  last_scraped    INTEGER,           -- unix timestamp
  next_scrape     INTEGER,           -- unix timestamp calculé
  scrape_priority INTEGER DEFAULT 1, -- 1=urgent, 10=jamais
  source_pref     TEXT,              -- 'vidsrc'/'animesama'/'mangadex'/...
  last_error      TEXT
);

-- Queue légère (backup de Upstash, toujours consultable)
CREATE TABLE IF NOT EXISTS scrape_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id        TEXT,
  job_type        TEXT,  -- 'import_meta'/'scrape_links'/'verify_links'
  priority        INTEGER,
  created_at      INTEGER,
  claimed_at      INTEGER,  -- null = disponible
  worker_id       TEXT
);

-- Sources connues et leur santé
CREATE TABLE IF NOT EXISTS sources (
  id              TEXT PRIMARY KEY,
  nom             TEXT,
  url_base        TEXT,
  type_scraper    TEXT,    -- 'api'/'cheerio'/'playwright'
  media_types     TEXT,    -- JSON array
  actif           INTEGER DEFAULT 1,
  cooldown_min    INTEGER DEFAULT 0,
  last_used       INTEGER,
  success_rate    REAL DEFAULT 1.0,    -- 0.0 à 1.0
  avg_links_found REAL DEFAULT 0.0
);

-- Index pour l'orchestrateur (next_scrape est le filtre principal)
CREATE INDEX IF NOT EXISTS idx_media_state_next_scrape ON media_state(next_scrape);

-- Mapping des IDs (Fribb/anime-lists)
CREATE TABLE IF NOT EXISTS id_mapping (
  tmdb_id         INTEGER,
  anilist_id      INTEGER,
  mal_id          INTEGER,
  imdb_id         TEXT,
  anidb_id        INTEGER,
  kitsu_id        INTEGER,
  livechart_id    INTEGER,
  type            TEXT, -- 'anime', 'movie', 'tv'
  PRIMARY KEY (tmdb_id, anilist_id)
);

-- Insertion de données de base
INSERT OR IGNORE INTO genres (nom, slug, type, tmdb_id) VALUES 
('Action', 'action', 'film', 28),
('Comédie', 'comedie', 'film', 35),
('Drame', 'drame', 'film', 18),
('Animation', 'animation', 'anime', 16),
('Science-Fiction', 'sf', 'film', 878),
('Horreur', 'horreur', 'film', 27);

INSERT OR IGNORE INTO pays (code, nom) VALUES 
('FR', 'France'),
('US', 'États-Unis'),
('JP', 'Japon'),
('KR', 'Corée du Sud');

INSERT OR IGNORE INTO plateformes (nom, slug, type) VALUES 
('Netflix', 'netflix', 'stream'),
('Disney+', 'disney-plus', 'stream'),
('Crunchyroll', 'crunchyroll', 'stream'),
('Amazon Prime Video', 'prime-video', 'stream');

INSERT OR IGNORE INTO sources (id, nom, type_scraper, media_types) VALUES
('vidsrc', 'VidSrc', 'api', '["film", "serie"]'),
('animesama', 'AnimeSama', 'cheerio', '["anime"]'),
('mangadex', 'MangaDex', 'api', '["manga"]'),
('flixhq', 'FlixHQ', 'cheerio', '["film", "serie"]');