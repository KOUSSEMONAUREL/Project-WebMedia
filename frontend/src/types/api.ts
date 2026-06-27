export interface ApiResponse<T> {
  success: boolean;
  data: T;
  count?: number;
  error?: string;
  source?: string;
  query?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T> {
  offset: number;
  limit: number;
  total: number;
}

export interface ApiError {
  success: false;
  error: string;
  path?: string;
}
