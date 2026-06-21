import { mockTrending, mockFilms, mockSeries, mockAnimes, mockGames, mockWebtoons, allMockData, getMockByType } from './mockData';
export { allMockData, getMockByType };

const API_BASE_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:8787/api';

async function apiClient<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    const response = await fetch(url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    if (!response.ok) throw new Error(`API Error: ${response.status} ${response.statusText}`);
    return await response.json();
}

export async function getTrending(): Promise<ApiResponse<Media[]>> {
    try {
        return await apiClient('/media/trending');
    } catch {
        return { success: true, data: mockTrending };
    }
}

export async function getMediaByType(type: MediaType): Promise<ApiResponse<Media[]>> {
    try {
        return await apiClient(`/media?type=${type}`);
    } catch {
        return { success: true, data: getMockByType(type) };
    }
}

export async function searchMedia(query: string, filters?: {
    type?: MediaType | 'all';
    year?: number;
    genre?: string;
}): Promise<ApiResponse<Media[]>> {
    const params = new URLSearchParams({ q: query });
    if (filters?.type) params.set('type', filters.type);
    if (filters?.year) params.set('year', filters.year.toString());
    if (filters?.genre) params.set('genre', filters.genre);
    try {
        return await apiClient(`/search?${params.toString()}`);
    } catch {
        const lowerQuery = query.toLowerCase();
        let results = allMockData.filter(m => m.title.toLowerCase().includes(lowerQuery));
        if (filters?.type && filters.type !== 'all') results = results.filter(m => m.type === filters.type);
        return { success: true, data: results };
    }
}

export async function getMediaDetails(type: string, slug: string): Promise<ApiResponse<Media>> {
    try {
        return await apiClient(`/media/${type}/${slug}`);
    } catch {
        const media = allMockData.find(m => m.type === type && m.slug === slug);
        if (media) return { success: true, data: media };
        throw new Error("Média non trouvé");
    }
}

export type MediaType = 'film' | 'serie' | 'anime' | 'jeu' | 'webtoon' | 'book' | 'novel';

export interface Media {
    id: string;
    title: string;
    type: MediaType;
    year: number;
    rating: number;
    posterUrl: string;
    slug?: string;
    synopsis?: string;
    genres?: string[];
    legalLinks?: LegalLink[];
}

export interface LegalLink {
    platform: string;
    url: string;
    type: 'stream' | 'buy' | 'rent';
}

export interface ApiResponse<T> {
    success: boolean;
    data: T;
    count?: number;
    error?: string;
}
