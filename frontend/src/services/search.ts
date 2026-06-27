import { apiGet } from './client';
import type { Media, MediaListResponse } from '../types';

export interface SearchFilters {
  type?: string;
  year?: number;
  limit?: number;
}

export async function search(query: string, filters?: SearchFilters): Promise<Media[]> {
  const res = await apiGet<MediaListResponse>('/search', {
    q: query,
    type: filters?.type,
    year: filters?.year,
    limit: filters?.limit,
  });
  return res.data || [];
}
