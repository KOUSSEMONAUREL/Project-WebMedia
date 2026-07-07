import { useState, useEffect, useCallback } from 'react';
import { MediaCard } from './MediaCard';
import { getMediaByType, type Media, type MediaType } from '../lib/api';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const PER_PAGE = 20;

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-8">
      {Array.from({ length: PER_PAGE }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <div className="aspect-[2/3] skeleton rounded-xl" />
          <div className="h-4 skeleton rounded w-3/4" />
          <div className="h-3 skeleton rounded w-1/3" />
        </div>
      ))}
    </div>
  );
}

interface Props {
  type: MediaType;
  title: string;
}

export function CategoryGrid({ type, title }: Props) {
  const [items, setItems] = useState<Media[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const fetchPage = useCallback(async (p: number) => {
    setIsLoading(true);
    setError('');
    try {
      const res = await getMediaByType(type, { limit: PER_PAGE, offset: p * PER_PAGE });
      setItems(res.data || []);
      if (res.total) setTotal(res.total);
    } catch {
      setError('Erreur de chargement');
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [type]);

  useEffect(() => {
    fetchPage(0);
  }, [fetchPage]);

  const goTo = (p: number) => {
    if (p < 0 || p >= totalPages || p === page) return;
    setPage(p);
    fetchPage(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="container mx-auto px-6 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-display font-bold mb-2"
          style={{ background: 'linear-gradient(135deg,#93c5fd,#60a5fa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          {title}
        </h1>
      </header>

      {error && (
        <div className="glass rounded-2xl p-8 text-center mb-8">
          <p className="text-destructive font-medium">{error}</p>
        </div>
      )}

      {isLoading ? <SkeletonGrid /> : (
        <>
          {items.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-8">
              {items.map((media) => (
                <MediaCard key={media.id} media={media} />
              ))}
            </div>
          )}
          {items.length === 0 && !error && (
            <div className="text-center py-24 text-muted-foreground">Aucun contenu trouve.</div>
          )}
        </>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-12">
          <button
            onClick={() => goTo(page - 1)}
            disabled={page <= 0}
            className="flex items-center gap-1 px-4 py-2 rounded-lg bg-secondary/50 text-sm font-medium hover:bg-secondary/80 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <ChevronLeft className="h-4 w-4" /> Precedent
          </button>
          <span className="text-sm text-muted-foreground">
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let p: number;
              if (totalPages <= 5) {
                p = i;
              } else if (page < 3) {
                p = i;
              } else if (page > totalPages - 4) {
                p = totalPages - 5 + i;
              } else {
                p = page - 2 + i;
              }
              return (
                <button
                  key={p}
                  onClick={() => goTo(p)}
                  className={`w-9 h-9 rounded-lg text-sm font-bold mx-0.5 transition-colors ${
                    p === page
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:text-primary'
                  }`}
                >
                  {p + 1}
                </button>
              );
            })}
          </span>
          <button
            onClick={() => goTo(page + 1)}
            disabled={page >= totalPages - 1}
            className="flex items-center gap-1 px-4 py-2 rounded-lg bg-secondary/50 text-sm font-medium hover:bg-secondary/80 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            Suivant <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
