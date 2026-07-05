-- Drop UNIQUE constraint on medias.tmdb_id
-- Multiple anime entries (e.g. different seasons) can share the same TMDB ID
ALTER TABLE "medias" DROP CONSTRAINT IF EXISTS "medias_tmdb_id_unique";
