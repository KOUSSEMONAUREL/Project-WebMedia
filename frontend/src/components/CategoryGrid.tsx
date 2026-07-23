import { useState, useEffect, useRef, useMemo } from 'react';
import { QueryClient, QueryClientProvider, useQuery, keepPreviousData } from '@tanstack/react-query';
import { MediaCard } from './MediaCard';
import { getMediaByType, type Media, type MediaType } from '../lib/api';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X } from 'lucide-react';

const PER_PAGE = 20;
type SortKey = 'created_at' | 'title' | 'rating' | 'year';

const GENRES = [
  'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary',
  'Drama', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery',
  'Romance', 'Science Fiction', 'Thriller', 'War', 'Western',
];

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-2 w-[120px] xs:w-[138px] sm:w-[160px] md:w-[180px] lg:w-[192px]">
      <div className="aspect-[2/3] w-full rounded-xl card-skeleton relative overflow-hidden">
        <div className="absolute top-2 right-2 w-10 h-4 rounded-md card-skeleton" />
        <div className="absolute bottom-2 left-2 w-12 h-4 rounded-md card-skeleton" />
      </div>
      <div className="flex flex-col gap-1.5 px-0.5">
        <div className="h-4 card-skeleton rounded w-full" />
        <div className="h-4 card-skeleton rounded w-2/3" />
        <div className="flex items-center gap-2">
          <div className="h-3 card-skeleton rounded w-8" />
          <div className="h-3 card-skeleton rounded w-10" />
          <div className="h-3 card-skeleton rounded w-8 ml-auto" />
        </div>
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-8">
      {Array.from({ length: PER_PAGE }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

type PageItem = { type: 'page'; num: number } | { type: 'ellipsis'; id: string };

function pageNumbers(current: number, total: number): PageItem[] {
  const cur = current + 1;
  if (total <= 7) return Array.from({ length: total }, (_, i) => ({ type: 'page', num: i + 1 }));
  const pages: PageItem[] = [{ type: 'page', num: 1 }];
  const start = Math.max(2, cur - 2);
  const end = Math.min(total - 1, cur + 2);
  if (start > 2) pages.push({ type: 'ellipsis', id: 'ellipsis-start' });
  for (let i = start; i <= end; i++) pages.push({ type: 'page', num: i });
  if (end < total - 1) pages.push({ type: 'ellipsis', id: 'ellipsis-end' });
  pages.push({ type: 'page', num: total });
  return pages;
}

interface Props {
  type: MediaType;
  title: string;
  initialData?: Media[];
  initialTotal?: number;
}

function GridContent({ type, title, initialData, initialTotal }: Props) {
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [genre, setGenre] = useState('');
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');
  const [ratingMin, setRatingMin] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);

  const filters = useMemo(() => ({
    genre: genre || undefined,
    yearMin: yearMin ? Number(yearMin) : undefined,
    yearMax: yearMax ? Number(yearMax) : undefined,
    ratingMin: ratingMin ? Number(ratingMin) : undefined,
  }), [genre, yearMin, yearMax, ratingMin]);
  const queryKey = ['media', type, sortKey, sortDir, page, genre, yearMin, yearMax, ratingMin];

  const isDefaultQuery = page === 0 && sortKey === 'created_at' && sortDir === 'desc' && !genre && !yearMin && !yearMax && !ratingMin;

  const { data, isPending, isError } = useQuery({
    queryKey,
    queryFn: () => getMediaByType(type, { limit: PER_PAGE, offset: page * PER_PAGE, sort: sortKey, order: sortDir, ...filters }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    gcTime: 300_000,
    ...(initialData && isDefaultQuery ? { initialData: { data: initialData, total: initialTotal } as any } : {}),
  });

  const items = data?.data || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  useEffect(() => {
    if (page < totalPages - 1) {
      queryClient.prefetchQuery({
        queryKey: ['media', type, sortKey, sortDir, page + 1, genre, yearMin, yearMax, ratingMin],
        queryFn: () => getMediaByType(type, { limit: PER_PAGE, offset: (page + 1) * PER_PAGE, sort: sortKey, order: sortDir, ...filters }),
        staleTime: 60_000,
      });
    }
  }, [page, type, sortKey, sortDir, genre, yearMin, yearMax, ratingMin, totalPages, filters]);

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

  const applyFilter = () => setPage(0);

  const sortLabel = (key: SortKey) => {
    const labels: Record<SortKey, string> = { created_at: 'Par defaut', title: 'Titre', rating: 'Note', year: 'Annee' };
    let label = labels[key];
    if (key === sortKey) label += sortDir === 'asc' ? ' \u2191' : ' \u2193';
    return label;
  };

  const hasActiveFilters = genre || yearMin || yearMax || ratingMin;
  const clearFilters = () => { setGenre(''); setYearMin(''); setYearMax(''); setRatingMin(''); setPage(0); };

  return (
    <div className="container mx-auto px-6 py-10" ref={gridRef} suppressHydrationWarning>
      <header className="mb-8">
        <h1 className="text-2xl md:text-3xl font-display font-bold mb-2"
          style={{ background: 'linear-gradient(135deg,#93c5fd,#60a5fa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          {title}
        </h1>
      </header>

      {isError && (
        <div className="glass rounded-2xl p-8 text-center mb-8">
          <p className="text-destructive font-medium">Erreur de chargement</p>
        </div>
      )}

      {!isPending && items.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Trier</span>
            {(['created_at', 'title', 'rating', 'year'] as SortKey[]).map((key) => (
              <button key={key} type="button" onClick={() => handleSort(key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border border-transparent ${sortKey === key ? 'bg-primary/12 text-primary border-primary/25' : 'bg-white/[0.03] text-muted-foreground hover:text-foreground hover:bg-white/[0.05]'}`}>
                {sortLabel(key)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-6 p-3 rounded-xl bg-secondary/20 border border-white/[0.04]">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Filtrer</span>
            <select aria-label="Genre" value={genre} onChange={(e) => { setGenre(e.target.value); setPage(0); }}
              className="bg-secondary/50 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary/40">
              <option value="">Genre</option>
              {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <input type="number" placeholder="Annee min" value={yearMin} onChange={(e) => setYearMin(e.target.value)} onBlur={applyFilter}
              className="w-24 bg-secondary/50 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary/40 [appearance:textfield]" />
            <input type="number" placeholder="Annee max" value={yearMax} onChange={(e) => setYearMax(e.target.value)} onBlur={applyFilter}
              className="w-24 bg-secondary/50 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary/40 [appearance:textfield]" />
            <input type="number" placeholder="Note min" value={ratingMin} onChange={(e) => setRatingMin(e.target.value)} onBlur={applyFilter} min={0} max={10} step={0.5}
              className="w-24 bg-secondary/50 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary/40 [appearance:textfield]" />
            {hasActiveFilters && (
              <button type="button" onClick={clearFilters} className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-3 w-3" /> Effacer
              </button>
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mb-8">
              <button type="button" onClick={() => goTo(page - 1)} disabled={page <= 0}
                className="flex items-center gap-1 px-4 py-2 rounded-lg bg-secondary/50 text-sm font-medium hover:bg-secondary/80 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                <ChevronLeft className="h-4 w-4" /> Precedent
              </button>
              <span className="text-sm text-muted-foreground">{page + 1} / {totalPages}</span>
              <button type="button" onClick={() => goTo(page + 1)} disabled={page >= totalPages - 1}
                className="flex items-center gap-1 px-4 py-2 rounded-lg bg-secondary/50 text-sm font-medium hover:bg-secondary/80 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                Suivant <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}

      {isPending ? <SkeletonGrid /> : (
        items.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-8">
            {items.map((media) => <MediaCard key={media.id} media={media} />)}
          </div>
        ) : (
          <div className="text-center py-24 text-muted-foreground">Aucun contenu trouve.</div>
        )
      )}

      {!isPending && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-12 flex-wrap">
          <button type="button" onClick={() => goTo(0)} disabled={page <= 0}
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-secondary/50 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-all">
            <ChevronsLeft className="h-3.5 w-3.5" /> Debut
          </button>
          <div className="flex items-center gap-1">
            {pageNumbers(page, totalPages).map((item) =>
              item.type === 'ellipsis' ? (
                <span key={item.id} className="px-1 text-sm text-muted-foreground select-none">...</span>
              ) : (
                <button key={item.num} type="button" onClick={() => goTo(item.num - 1)}
                  className={`w-9 h-9 rounded-lg text-sm font-bold transition-colors ${item.num === page + 1 ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 text-muted-foreground hover:text-primary hover:bg-secondary'}`}>
                  {item.num}
                </button>
              ),
            )}
          </div>
          <button type="button" onClick={() => goTo(totalPages - 1)} disabled={page >= totalPages - 1}
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-secondary/50 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-all">
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
