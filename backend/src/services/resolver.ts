
export interface MediaState {
    media_id: string;
    type: string;
    metadata_ok: number;
    active_links: number;
    has_content: number;
    last_scraped: number | null;
    next_scrape: number | null;
    scrape_priority: number;
    source_pref: string | null;
    last_error: string | null;
}

export interface MetadataMapping {
    media_id: string;
    tmdb_id: number | null;
    imdb_id: string | null;
    anilist_id: number | null;
    mal_id: number | null;
    kitsu_id: number | null;
    igdb_id: number | null;
    anidb_id: number | null;
}

export async function getMediaState(d1: D1Database, mediaId: string): Promise<MediaState | null> {
    return await d1.prepare('SELECT * FROM media_state WHERE media_id = ?').bind(mediaId).first<MediaState>();
}

export async function resolveAction(state: MediaState) {
    const now = Date.now();

    // 1. Métadonnées non OK -> IMPORT_META
    if (!state.metadata_ok) {
        return { action: 'IMPORT_META', queue: 'queue:import' };
    }

    // 2. Fraîcheur : si on a assez de liens et que c'est récent (< 24h) -> SKIP
    const age = state.last_scraped ? now - state.last_scraped : Infinity;
    if (state.active_links >= 2 && age < 24 * 3600 * 1000) {
        return { action: 'SKIP' };
    }

    // 3. Routing par type
    if (state.type === 'film' || state.type === 'serie' || state.type === 'anime') {
        return { action: 'SKIP' };
    }

    if (state.type === 'manga' || state.type === 'webtoon' || state.type === 'comic') {
        return { action: 'SCRAPE_WEBTOON', queue: 'queue:scrape:webtoon' };
    }

    if (state.type === 'game' || state.type === 'jeu') {
        return { action: 'SCRAPE_GAME', queue: 'queue:scrape:playwright' };
    }

    return { action: 'SKIP' };
}
