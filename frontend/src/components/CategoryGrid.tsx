import { useState, useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider, useQuery, keepPreviousData } from '@tanstack/react-query';
import { MediaCard } from './MediaCard';
import { getMediaByType, type Media, type MediaType } from '../lib/api';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

const PER_PAGE = 20;
type SortKey = 'created_at' | 'title' | 'rating' | 'year';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

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

function pageNumbers(current: number, total: number): (number | string)[] {
  const cur = current + 1;
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | string)[] = [1];
  const start = Math.max(2, cur - 2);
  const end = Math.min(total - 1, cur + 2);
  if (start > 2) pages.push('...');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push('...');
  pages.push(total);
  return pages;
}

interface Props {
  type: MediaType;
  title: string;
}

function GridContent({ type, title }: Props) {
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const gridRef = useRef<HTMLDivElement>(null);

  const queryKey = ['media', type, sortKey, sortDir, page];

  const { data, isPending, isError } = useQuery({
    queryKey,
    queryFn: () =>
      getMediaByType(type, { limit: PER_PAGE, offset: page * PER_PAGE, sort: sortKey, order: sortDir }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    gcTime: 300_000,
  });

  const items = data?.data || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  // Prefetch next page
  useEffect(() => {
    if (page < totalPages - 1) {
      queryClient.prefetchQuery({
        queryKey: ['media', type, sortKey, sortDir, page + 1],
        queryFn: () =>
          getMediaByType(type, { limit: PER_PAGE, offset: (page + 1) * PER_PAGE, sort: sortKey, order: sortDir }),
        staleTime: 60_000,
      });
    }
  }, [page, type, sortKey, sortDir, totalPages]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'title' ? 'asc' : 'desc');
    }
    setPage(0);
  };

  const goTo = (p: number) => {
    if (p < 0 || p >= totalPages || p === page) return;
    setPage(p);
    gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const sortLabel = (key: SortKey) => {
    const labels: Record<SortKey, string> = {
      created_at: 'Par defaut',
      title: 'Titre',
      rating: 'Note',
      year: 'Annee',
    };
    let label = labels[key];
    if (key === sortKey) {
      label += sortDir === 'asc' ? ' \u2191' : ' \u2193';
    }
    return label;
  };

  return (
    <div className="container mx-auto px-6 py-10" ref={gridRef} suppressHydrationWarning>
      <header className="mb-8">
        <h1
          className="text-2xl md:text-3xl font-display font-bold mb-2"
          style={{
            background: 'linear-gradient(135deg,#93c5fd,#60a5fa)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          {title}
        </h1>
      </header>

      {isError && (
        <div className="glass rounded-2xl p-8 text-center mb-8">
          <p className="text-destructive font-medium">Erreur de chargement</p>
        </div>
      )}

      {isPending ? (
        <SkeletonGrid />
      ) : (
        <>
          {items.length > 0 && (
            <>
              <div className="flex items-center gap-2 mb-6 flex-wrap">
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Trier</span>
                {(['created_at', 'title', 'rating', 'year'] as SortKey[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => handleSort(key)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border border-transparent ${
                      sortKey === key
                        ? 'bg-primary/12 text-primary border-primary/25 shadow-[0_0_16px_rgba(59,130,246,0.08)]'
                        : 'bg-white/[0.03] text-muted-foreground hover:text-foreground hover:bg-white/[0.05] hover:border-white/[0.08]'
                    }`}
                  >
                    {sortLabel(key)}
                  </button>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-4 mb-8">
                  <button
                    onClick={() => goTo(page - 1)}
                    disabled={page <= 0}
                    className="flex items-center gap-1 px-4 py-2 rounded-lg bg-secondary/50 text-sm font-medium hover:bg-secondary/80 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronLeft className="h-4 w-4" /> Precedent
                  </button>
                  <span className="text-sm text-muted-foreground">
                    {page + 1} / {totalPages}
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

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-8">
                {items.map((media) => (
                  <MediaCard key={media.id} media={media} />
                ))}
              </div>
            </>
          )}
          {items.length === 0 && (
            <div className="text-center py-24 text-muted-foreground">Aucun contenu trouve.</div>
          )}
        </>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-12 flex-wrap">
          <button
            onClick={() => goTo(0)}
            disabled={page <= 0}
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-secondary/50 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <ChevronsLeft className="h-3.5 w-3.5" /> Debut
          </button>
          <div className="flex items-center gap-1">
            {pageNumbers(page, totalPages).map((n, i) =>
              typeof n === 'string' ? (
                <span key={`e${i}`} className="px-1 text-sm text-muted-foreground select-none">
                  {n}
                </span>
              ) : (
                <button
                  key={n}
                  onClick={() => goTo(n - 1)}
                  className={`w-9 h-9 rounded-lg text-sm font-bold transition-colors ${
                    n === page + 1
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary/50 text-muted-foreground hover:text-primary hover:bg-secondary'
                  }`}
                >
                  {n}
                </button>
              ),
            )}
          </div>
          <button
            onClick={() => goTo(totalPages - 1)}
            disabled={page >= totalPages - 1}
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-secondary/50 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            Fin <ChevronsRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export function CategoryGrid(props: Props) {
  return (
    <QueryClientProvider client={queryClient}>
      <GridContent {...props} />
    </QueryClientProvider>
  );
}
