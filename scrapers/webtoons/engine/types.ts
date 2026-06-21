export type MangaStatus = 0 | 1 | 2 | 3 | undefined; // completed / ongoing / cancelled / unknown

export interface Manga {
    title: string;
    url: string;
    thumbnailUrl: string;
    lang: string;
    author?: string;
    artist?: string;
    description?: string;
    genre?: string;
    status?: MangaStatus;
}

export interface Chapter {
    name: string;
    url: string;
    chapterNumber?: number;
    scanlator?: string;
    dateUpload?: number;
}

export interface Page {
    imageUrl: string;
    index: number;
}

export interface SearchResult {
    mangas: Manga[];
    hasNextPage: boolean;
}
