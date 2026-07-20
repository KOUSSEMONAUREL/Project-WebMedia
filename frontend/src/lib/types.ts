export type MediaType = 'film' | 'serie' | 'anime' | 'jeu' | 'webtoon' | 'comic' | 'book' | 'novel';

export interface Media {
  id: string; title: string; type: MediaType; year?: number; rating?: number;
  posterUrl?: string; slug?: string; synopsis?: string; genres?: string[];
  legalLinks?: LegalLink[]; voteCount?: number; status?: string;
  tmdbId?: number; imdbId?: string; anilistId?: number;
  metadataSource?: string; activeLinksCount?: number;
  createdAt?: string; updatedAt?: string;
  backdropUrl?: string; episodes?: any[]; links?: any[]; similar?: Media[];
  trailerUrl?: string; duration?: number; tagline?: string;
  studios?: string[]; episodeCount?: number;
  author?: string; originalTitle?: string;
  externalId?: string; malId?: number; kitsuId?: number; igdbId?: number; anidbId?: number;
}

export interface LegalLink { platform: string; url: string; type: 'stream' | 'buy' | 'rent'; }

export interface ApiResponse<T> {
  success: boolean; data: T; count?: number; error?: string;
}
