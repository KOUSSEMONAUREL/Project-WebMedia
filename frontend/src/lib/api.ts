import type { Media, MediaType } from './types';
import { mockTrending, mockFilms, mockSeries, mockAnimes, mockGames, mockWebtoons, allMockData, getMockByType } from './mockData';
export { allMockData, getMockByType };

const API_BASE_URL = (import.meta.env.PUBLIC_API_URL || 'http://localhost:8787').replace(/\/+$/, '') + '/api';
const API_KEY = import.meta.env.PUBLIC_API_KEY || '';

export function getApiHeaders(extra?: Record<string, string>): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(API_KEY ? { 'X-Internal-API-Key': API_KEY } : {}), ...extra };
}

async function apiClient<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: { ...getApiHeaders(), ...options.headers },
  });
  if (!response.ok) throw new Error(`API Error: ${response.status} ${response.statusText}`);
  return await response.json();
}

const API_TYPE_MAP: Record<string, string> = {
  movie: 'film',
  game: 'jeu',
  comic: 'webtoon',
};

function mapTypes(items: Media[]): Media[] {
  return items.map(m => ({ ...m, type: API_TYPE_MAP[m.type] || m.type }));
}

export async function getTrending(): Promise<ApiResponse<Media[]>> {
  try {
    const res = await apiClient<ApiResponse<Media[]>>('/media/trending');
    if (Array.isArray(res.data)) return { success: true, data: mapTypes(res.data) };
    if (res.data && Array.isArray((res.data as any).data)) return { success: true, data: mapTypes((res.data as any).data) };
    return { success: true, data: [] };
  }
  catch { return { success: true, data: mockTrending }; }
}

export async function getMediaByType(
  type: MediaType,
  opts?: { limit?: number; offset?: number; sort?: string; order?: string },
): Promise<{ success: boolean; data: Media[]; total?: number }> {
  try {
    const params = new URLSearchParams({ type });
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    if (opts?.sort) params.set('sort', opts.sort);
    if (opts?.order) params.set('order', opts.order);
    const res = await fetch(`${API_BASE_URL}/media?${params}`, { headers: getApiHeaders() });
    if (!res.ok) throw new Error('API Error');
    const json = await res.json();
    if (json.data) json.data = json.data.map((m: Media) => ({ ...m, type }));
    return json;
  } catch {
    const data = getMockByType(type);
    return { success: true, data, total: data.length };
  }
}

export async function getAllMedia(): Promise<Media[]> {
  try {
    const res = await apiClient<ApiResponse<Media[]>>('/media');
    return mapTypes(res.data);
  } catch {
    return allMockData;
  }
}

export async function searchMedia(query: string, filters?: {
  type?: MediaType | 'all'; year?: number; genre?: string;
}): Promise<ApiResponse<Media[]>> {
  try {
    const params = new URLSearchParams({ q: query });
    if (filters?.type && filters.type !== 'all') params.set('type', filters.type);
    if (filters?.year) params.set('year', filters.year.toString());
    const res = await apiClient<ApiResponse<Media[]>>(`/search?${params.toString()}`);
    if (res.data) res.data = mapTypes(res.data);
    return res;
  } catch {
    const lowerQuery = query.toLowerCase();
    let results = allMockData.filter(m => m.title?.toLowerCase().includes(lowerQuery));
    if (filters?.type && filters.type !== 'all') results = results.filter(m => m.type === filters.type);
    return { success: true, data: results };
  }
}

export async function getMediaDetails(type: string, slug: string): Promise<ApiResponse<Media>> {
  try {
    const res = await apiClient<ApiResponse<Media>>(`/media/${type}/${slug}`);
    if (res.data) res.data = { ...res.data, type: API_TYPE_MAP[res.data.type] || res.data.type };
    return res;
  }
  catch {
    const media = allMockData.find(m => m.type === type && m.slug === slug);
    if (media) return { success: true, data: media };
    throw new Error('Média non trouvé');
  }
}

export type { Media, MediaType, LegalLink, ApiResponse } from './types';
