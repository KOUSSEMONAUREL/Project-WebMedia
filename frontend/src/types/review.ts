import type { ApiResponse } from './api';

export interface Review {
  id: string;
  userId: string;
  mediaId: string;
  rating: number;
  comment?: string;
  spoiler: boolean;
  likes: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReviewPayload {
  mediaId: string;
  rating: number;
  comment?: string;
  spoiler?: boolean;
}

export type ReviewListResponse = ApiResponse<Review[]>;
