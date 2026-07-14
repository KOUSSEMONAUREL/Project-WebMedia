import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useTurnstile } from './Turnstile';
import { useCachedSession } from '../lib/auth-client';
import { getReviews, createReview } from '../services/reviews';
import type { Review } from '../types';
import { getDisplayNameInitials } from '../lib/utils';

interface Props {
  mediaId: string;
}

const STAR_FULL = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

const STAR_EMPTY = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "a l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `il y a ${days}j`;
  return new Date(dateStr).toLocaleDateString('fr-FR');
}

function StarRating({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: 10 }, (_, i) => (
        <button
          type="button"
          onClick={() => onChange?.(i + 1)}
          className="transition-all duration-150"
          style={{
            color: i < value ? '#FBBF24' : 'rgba(255,255,255,0.2)',
            cursor: onChange ? 'pointer' : 'default',
            transform: onChange && i < value ? 'scale(1.1)' : 'scale(1)',
          }}
        >
          {i < value ? STAR_FULL : STAR_EMPTY}
        </button>
      ))}
    </div>
  );
}

function ReviewCard({ review }: { review: Review }) {
  const initials = getDisplayNameInitials(review.user?.name || 'Anonyme');

  return (
    <div
      className="rounded-xl p-4 transition-all"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="flex items-start gap-3">
        <div
          className="size-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
          style={{ background: 'rgba(59,130,246,0.15)', color: '#60A5FA' }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>
              {review.user?.name || 'Anonyme'}
            </span>
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
              {timeAgo(review.createdAt)}
            </span>
            {review.spoiler && (
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-md"
                style={{ background: 'rgba(239,68,68,0.12)', color: '#F87171', border: '1px solid rgba(239,68,68,0.15)' }}
              >
                SPOILER
              </span>
            )}
          </div>
          <div className="mt-1">
            <StarRating value={review.rating} />
          </div>
          {review.comment && (
            <p className="mt-2 text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {review.comment}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ReviewSection({ mediaId }: Props) {
  const { data: session } = useCachedSession();
  const { getToken, reset: resetTurnstile, ready: turnstileReady } = useTurnstile();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [spoiler, setSpoiler] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getReviews(mediaId);
      setReviews(data);
    } catch {
      setError("Erreur lors du chargement des reviews");
    } finally {
      setLoading(false);
    }
  }, [mediaId]);

  useEffect(() => { load(); }, [load]);

  const user = session?.user;
  const isLoggedIn = !!user;
  const canSubmit = rating > 0 && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const turnstileToken = await getToken();
      await createReview({
        mediaId,
        rating,
        comment: comment.trim() || undefined,
        spoiler,
        turnstileToken,
      });

      setRating(0);
      setComment('');
      setSpoiler(false);
      resetTurnstile();
      await load();
      toast.success('Review publiee', { duration: 2500 });
    } catch (err: any) {
      setSubmitError(err.message || "Erreur lors de la création de la review");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-6">
      <h2 className="text-xl font-bold" style={{ color: 'rgba(255,255,255,0.85)' }}>
        Reviews ({reviews.length})
      </h2>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-full card-skeleton" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-24 rounded card-skeleton" />
                  <div className="h-3 w-32 rounded card-skeleton" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm" style={{ color: '#EF4444' }}>{error}</p>
      )}

      {!loading && !error && reviews.length === 0 && (
        <div className="rounded-xl p-8 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Aucune review pour ce media pour le moment.
          </p>
        </div>
      )}

      {!loading && !error && reviews.length > 0 && (
        <div className="space-y-3">
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      )}

      <div className="rounded-xl p-6" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <h3 className="text-base font-semibold mb-4" style={{ color: 'rgba(255,255,255,0.8)' }}>
          {isLoggedIn ? 'Poster une review' : 'Vous souhaitez donner votre avis ?'}
        </h3>

        {!isLoggedIn ? (
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Connectez-vous via le bouton en haut a droite pour publier une review.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Note
              </label>
              <StarRating value={rating} onChange={setRating} />
            </div>

            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Commentaire (optionnel)
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Votre avis..."
                className="w-full rounded-xl px-4 py-3 text-sm transition-all resize-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.8)', outline: 'none' }}
                onFocus={(e) => { e.target.style.borderColor = 'rgba(59,130,246,0.4)'; }}
                onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.08)'; }}
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={spoiler}
                onChange={(e) => setSpoiler(e.target.checked)}
                className="rounded"
                style={{ accentColor: '#3B82F6' }}
              />
              <span className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                Contient un spoiler
              </span>
            </label>

            {submitError && (
              <p className="text-sm" style={{ color: '#EF4444' }}>{submitError}</p>
            )}

            <button
              type="submit"
              disabled={!canSubmit || !turnstileReady}
              className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: canSubmit ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${canSubmit ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.06)'}`,
                color: canSubmit ? '#60A5FA' : 'rgba(255,255,255,0.3)',
              }}
            >
              {submitting ? 'Publication...' : 'Publier la review'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
