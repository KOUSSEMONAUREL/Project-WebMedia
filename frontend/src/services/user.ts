import { apiGet } from './client';
import type { Media, MediaListResponse } from '../types';

export async function getFavorites(): Promise<Media[]> {
  try {
    const res = await apiGet<MediaListResponse>('/user/favorites', undefined, true);
    return res.data || [];
  } catch {
    return [];
  }
}
