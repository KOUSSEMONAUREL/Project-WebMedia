import { apiGet } from './client';
import type { Genre, Plateforme, GenreListResponse, PlateformeListResponse } from '../types';

const FALLBACK_GENRES: Genre[] = [
  'Action', 'Aventure', 'Comédie', 'Drame', 'Fantastique',
  'Horreur', 'Mystère', 'Romance', 'Science-Fiction', 'Thriller',
  'Animation', 'Documentaire', 'Crime', 'Famille',
].map((nom, i) => ({ id: i + 1, nom, slug: nom.toLowerCase(), type: 'all' }));

export async function getGenres(): Promise<Genre[]> {
  try {
    const res = await apiGet<GenreListResponse>('/static/genres');
    return (res.data || []).sort((a, b) => a.nom.localeCompare(b.nom));
  } catch {
    return FALLBACK_GENRES;
  }
}

export async function getPlateformes(): Promise<Plateforme[]> {
  try {
    const res = await apiGet<PlateformeListResponse>('/static/plateformes');
    return res.data || [];
  } catch {
    return [];
  }
}
