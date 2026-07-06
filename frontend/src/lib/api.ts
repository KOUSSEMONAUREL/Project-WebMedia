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

export async function getTrending(): Promise<ApiResponse<Media[]>> {
  try {
    const res = await apiClient<ApiResponse<Media[]>>('/media/trending');
    if (Array.isArray(res.data)) return res;
    if (res.data && Array.isArray((res.data as any).data)) return { success: true, data: (res.data as any).data };
    return { success: true, data: [] };
  }
  catch { return { success: true, data: mockTrending }; }
}

export async function getMediaByType(type: MediaType): Promise<ApiResponse<Media[]>> {
  try {
    const res = await apiClient<ApiResponse<Media[]>>(`/media?type=${type}`);
    if (res.data) res.data = res.data.map(m => ({ ...m, type }));
    return res;
  }
  catch { return { success: true, data: getMockByType(type) }; }
}

export async function getAllMedia(): Promise<Media[]> {
  try {
    const res = await apiClient<ApiResponse<Media[]>>('/media');
    return res.data;
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
    return await apiClient(`/search?${params.toString()}`);
  } catch {
    const lowerQuery = query.toLowerCase();
    let results = allMockData.filter(m => m.title?.toLowerCase().includes(lowerQuery));
    if (filters?.type && filters.type !== 'all') results = results.filter(m => m.type === filters.type);
    return { success: true, data: results };
  }
}

export async function getMediaDetails(type: string, slug: string): Promise<ApiResponse<Media>> {
  try { return await apiClient(`/media/${type}/${slug}`); }
  catch {
    const media = allMockData.find(m => m.type === type && m.slug === slug);
    if (media) return { success: true, data: media };
    throw new Error('Média non trouvé');
  }
}

export type { Media, MediaType, LegalLink, ApiResponse } from './types';
