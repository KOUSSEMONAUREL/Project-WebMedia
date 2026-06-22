-- Schéma Global WebMedia (PostgreSQL - Neon)
-- ATTENTION: La source de vérité est backend/src/db/neon/schema.ts (Drizzle ORM).
-- Ce fichier est généré manuellement et peut être obsolète.
-- Pour régénérer: cd backend && npx drizzle-kit generate

CREATE TABLE IF NOT EXISTS medias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id VARCHAR(100),
    type VARCHAR(20) NOT NULL,
    title VARCHAR(500) NOT NULL,
    original_title VARCHAR(500),
    slug VARCHAR(500) NOT NULL UNIQUE,
    synopsis TEXT,
    year INTEGER,
    author VARCHAR(300),
    poster_url TEXT,
    backdrop_url TEXT,
    rating DECIMAL(3,1),
    vote_count INTEGER DEFAULT 0,
    status VARCHAR(20),
    tmdb_id INTEGER UNIQUE,
    imdb_id VARCHAR(20),
    anilist_id INTEGER UNIQUE,
    mal_id INTEGER,
    kitsu_id INTEGER,
    igdb_id INTEGER,
    anidb_id INTEGER,
    metadata_source VARCHAR(50) DEFAULT 'tmdb',
    metadata_fresh_at TIMESTAMPTZ,
    links_last_scraped_at TIMESTAMPTZ,
    active_links_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS episodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id UUID REFERENCES medias(id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL,
    episode_number INTEGER NOT NULL,
    title VARCHAR(500),
    synopsis TEXT,
    air_date DATE,
    thumbnail_url TEXT,
    duration INTEGER
);

CREATE TABLE IF NOT EXISTS liens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id UUID REFERENCES medias(id) ON DELETE CASCADE,
    episode_id UUID REFERENCES episodes(id) ON DELETE CASCADE,
    source_site VARCHAR(100) NOT NULL,
    player_host VARCHAR(100),
    url TEXT NOT NULL,
    quality VARCHAR(20),
    language VARCHAR(20),
    has_subtitles BOOLEAN DEFAULT FALSE,
    headers JSONB,
    is_active BOOLEAN DEFAULT TRUE,
    fail_count INTEGER DEFAULT 0,
    last_verified TIMESTAMPTZ,
    scraped_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Index existants
CREATE INDEX IF NOT EXISTS idx_medias_tmdb ON medias(tmdb_id);
CREATE INDEX IF NOT EXISTS idx_medias_anilist ON medias(anilist_id);
CREATE INDEX IF NOT EXISTS idx_liens_media ON liens(media_id);

-- Index manquants — hot paths
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_episodes_media_id ON episodes(media_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_liens_media_active ON liens(media_id, is_active) WHERE is_active = true;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_medias_type_slug ON medias(type, slug);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_medias_type_updated ON medias(type, updated_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_medias_updated_at ON medias(updated_at) WHERE updated_at IS NOT NULL;

-- Index unique pour UPSERT liens (évite les doublons scrapers)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_liens_media_url ON liens(media_id, url);

-- Table offsets import (10 lignes, ~200 octets)
CREATE TABLE IF NOT EXISTS import_offsets (
    key VARCHAR(50) PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
