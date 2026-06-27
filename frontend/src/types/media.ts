import type { ApiResponse } from './api';

export type MediaType = 'film' | 'serie' | 'anime' | 'jeu' | 'webtoon';

export interface Media {
  id: string;
  externalId?: string;
  type: MediaType;
  title: string;
  originalTitle?: string;
  slug: string;
  synopsis?: string;
  year?: number;
  posterUrl?: string;
  backdropUrl?: string;
  rating?: number;
  voteCount: number;
  status?: string;
  tmdbId?: number;
  imdbId?: string;
  anilistId?: number;
  metadataSource?: string;
  activeLinksCount: number;
  createdAt: string;
  updatedAt: string;
  genres?: string[];
  episodes?: Episode[];
  links?: Lien[];
  legalLinks?: LegalLink[];
}

export interface Episode {
  id: string;
  mediaId: string;
  seasonNumber: number;
  episodeNumber: number;
  title?: string;
  synopsis?: string;
  airDate?: string;
  thumbnailUrl?: string;
  duration?: number;
}

export interface Lien {
  id: string;
  mediaId: string;
  episodeId?: string;
  sourceSite: string;
  playerHost?: string;
  url: string;
  quality?: string;
  language?: string;
  hasSubtitles: boolean;
  headers?: Record<string, string>;
  isActive: boolean;
  failCount: number;
  lastVerified?: string;
  scrapedAt: string;
}

export interface LegalLink {
  platform: string;
  url: string;
  type: 'stream' | 'buy' | 'rent';
}

export type MediaListResponse = ApiResponse<Media[]>;
export type MediaDetailResponse = ApiResponse<Media>;
