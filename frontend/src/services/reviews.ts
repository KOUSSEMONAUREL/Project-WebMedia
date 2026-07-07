import { apiGet, apiPost } from './client';
import type { Review, ReviewListResponse, CreateReviewPayload } from '../types';

export async function getReviews(mediaId: string): Promise<Review[]> {
  const res = await apiGet<ReviewListResponse>(`/reviews/${mediaId}`);
  return res.data || [];
}

export async function createReview(payload: CreateReviewPayload): Promise<Review> {
  const { turnstileToken, ...body } = payload;
  const headers: Record<string, string> = {};
  if (turnstileToken) {
    headers['X-Turnstile-Token'] = turnstileToken;
  }
  const res = await apiPost<ReviewListResponse>('/reviews', body, headers);
  if (!res.success || !res.data) throw new Error(res.error || "Erreur création review");
  return res.data as unknown as Review;
}
