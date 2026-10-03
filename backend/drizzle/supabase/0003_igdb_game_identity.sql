-- Identite de jeu issue d'IGDB.
-- game_type : 1 = jeu principal, 8 = remake, 10 = DLC/expansion.
--   Permet de ne garder que les vrais jeux et d'ecarter les editions/DLC.
-- parent_game_name : nom du jeu de base declare par IGDB. Sert d'alias
--   explicite pour le rapprochement des liens (ex: "Terraria: Calamity Mod"
--   -> "Terraria"), donc plus besoin de deviner la correspondance.
ALTER TABLE "medias" ADD COLUMN IF NOT EXISTS "game_type" integer;
ALTER TABLE "medias" ADD COLUMN IF NOT EXISTS "parent_game_name" varchar(500);
ALTER TABLE "medias" ADD COLUMN IF NOT EXISTS "version_parent_name" varchar(500);

ALTER TABLE "medias" ADD COLUMN IF NOT EXISTS "official_url" text;
ALTER TABLE "medias" ADD COLUMN IF NOT EXISTS "store_url" text;

CREATE INDEX IF NOT EXISTS "medias_igdb_game_type_idx" ON "medias" ("game_type");
CREATE INDEX IF NOT EXISTS "medias_parent_game_name_idx" ON "medias" ("parent_game_name");

-- Le job de scrape doit porter le nom du jeu de base donne par IGDB: c'est
-- lui qui sert d'alias dans le worker pour rattacher un mod ou une edition a
-- la bonne fiche, sans deviner.
ALTER TABLE "scraping_jobs" ADD COLUMN IF NOT EXISTS "parent_game_name" varchar(500);
