import type { ApiResponse } from './api';

export interface Genre {
  id: number;
  nom: string;
  slug: string;
  type: string;
  tmdbId?: number;
}

export interface Plateforme {
  id: number;
  nom: string;
  slug: string;
  logoUrl?: string;
  url?: string;
  type?: string;
}

export interface Pays {
  id: number;
  code: string;
  nom: string;
}

export interface Source {
  id: string;
  nom: string;
  urlBase?: string;
  typeScraper: string;
  mediaTypes: string;
  actif: number;
}

export type GenreListResponse = ApiResponse<Genre[]>;
export type PlateformeListResponse = ApiResponse<Plateforme[]>;
