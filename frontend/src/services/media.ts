import { apiGet } from './client';
import type { Media, MediaListResponse, MediaDetailResponse } from '../types';

export async function getTrending(): Promise<Media[]> {
  const res = await apiGet<MediaListResponse>('/media/trending');
  return res.data || [];
}

export async function getByType(
  type: string,
  options?: { limit?: number; offset?: number }
): Promise<Media[]> {
  const res = await apiGet<MediaListResponse>('/media', {
    type,
    limit: options?.limit,
    offset: options?.offset,
  });
  return res.data || [];
}

export async function getDetails(type: string, slug: string): Promise<Media> {
  const res = await apiGet<MediaDetailResponse>(`/media/${type}/${slug}`);
  if (!res.success || !res.data) throw new Error(res.error || 'Média non trouvé');
  return res.data;
}
