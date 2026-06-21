CREATE TABLE IF NOT EXISTS "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"season_number" integer NOT NULL,
	"episode_number" integer NOT NULL,
	"title" varchar(500),
	"synopsis" text,
	"air_date" timestamp,
	"thumbnail_url" text,
	"duration" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "liens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"episode_id" uuid,
	"source_site" varchar(100) NOT NULL,
	"player_host" varchar(100),
	"url" text NOT NULL,
	"quality" varchar(20),
	"language" varchar(20),
	"has_subtitles" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"fail_count" integer DEFAULT 0,
	"last_verified" timestamp,
	"scraped_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "medias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" varchar(100),
	"type" varchar(20) NOT NULL,
	"title" varchar(500) NOT NULL,
	"original_title" varchar(500),
	"slug" varchar(500) NOT NULL,
	"synopsis" text,
	"year" integer,
	"poster_url" text,
	"backdrop_url" text,
	"rating" numeric(3, 1),
	"vote_count" integer DEFAULT 0,
	"status" varchar(20),
	"tmdb_id" integer,
	"imdb_id" varchar(20),
	"anilist_id" integer,
	"mal_id" integer,
	"kitsu_id" integer,
	"igdb_id" integer,
	"anidb_id" integer,
	"metadata_source" varchar(50) DEFAULT 'tmdb',
	"metadata_fresh_at" timestamp with time zone,
	"links_last_scraped_at" timestamp with time zone,
	"active_links_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "medias_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "episodes" ADD CONSTRAINT "episodes_media_id_medias_id_fk" FOREIGN KEY ("media_id") REFERENCES "medias"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "liens" ADD CONSTRAINT "liens_media_id_medias_id_fk" FOREIGN KEY ("media_id") REFERENCES "medias"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "liens" ADD CONSTRAINT "liens_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
