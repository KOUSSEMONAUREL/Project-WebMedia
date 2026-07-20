import { useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { MediaCard } from './MediaCard';
import { getMediaByType, type Media, type MediaType } from '../lib/api';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const MEDIA_TABS: { type: MediaType; label: string }[] = [
  { type: 'film', label: 'Films' },
  { type: 'serie', label: 'Series' },
  { type: 'anime', label: 'Animes' },
  { type: 'jeu', label: 'Jeux' },
  { type: 'comic', label: 'Comics' },
  { type: 'webtoon', label: 'Webtoons' },
  { type: 'book', label: 'Livres' },
  { type: 'novel', label: 'Light Novels' },
];

const PER_PAGE = 8;

const genreMap: Record<string, string[]> = {
  action: ['Action', 'Action & Adventure'],
  aventure: ['Aventure', 'Adventure'],
  comedie: ['Comédie', 'Comedy'],
  drame: ['Drame', 'Drama'],
  fantastique: ['Fantastique', 'Fantasy'],
  horreur: ['Horreur', 'Horror'],
  mystere: ['Mystère', 'Mystery'],
  romance: ['Romance'],
  'science-fiction': ['Science-Fiction', 'Sci-Fi'],
  thriller: ['Thriller'],
  animation: ['Animation'],
  documentaire: ['Documentaire'],
  crime: ['Crime'],
  famille: ['Familial', 'Family', 'Famille'],
  western: ['Western'],
  rpg: ['RPG'],
  'arts-martiaux': ['Arts Martiaux'],
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function GenreTab({ type, label, genreParam, isActive, onSelect }: {
  type: MediaType; label: string; genreParam: string; isActive: boolean; onSelect: () => void;
}) {
  const { data } = useQuery({
    queryKey: ['genre-count', type, genreParam],
    queryFn: () => getMediaByType(type, { limit: 1, genre: genreParam }),
    staleTime: 120_000,
  });

  return (
    <button onClick={onSelect}
      class={`px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
        isActive
          ? 'bg-primary text-white shadow-lg shadow-primary/20'
          : 'bg-secondary/50 text-muted-foreground hover:bg-secondary/80 hover:text-foreground'
      }`}>
      {label}
      {data?.total ? <span class="ml-1.5 text-xs opacity-60">({data.total})</span> : null}
    </button>
  );
}

function TypeContent({ type, label, genreParam }: { type: MediaType; label: string; genreParam: string }) {
  const [page, setPage] = useState(0);

  const { data, isPending } = useQuery({
    queryKey: ['genre', type, genreParam, page],
    queryFn: () => getMediaByType(type, { limit: PER_PAGE, offset: page * PER_PAGE, genre: genreParam }),
    staleTime: 60_000,
  });

  const items = data?.data || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  if (!isPending && items.length === 0) {
    return (
      <div class="text-center py-16 text-muted-foreground">
        Aucun contenu trouve pour ce genre.
      </div>
    );
  }

  return (
    <>
      <div class="flex items-center gap-3 mb-4">
        <h2 class="text-xl font-bold text-foreground">{label}</h2>
        {!isPending && <span class="text-xs text-muted-foreground bg-white/5 px-2 py-0.5 rounded-full">{total}</span>}
      </div>

      {isPending ? (
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} class="aspect-[2/3] w-full rounded-xl card-skeleton" />
          ))}
        </div>
      ) : (
        <>
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-8">
            {items.map((media) => <MediaCard key={media.id} media={media} />)}
          </div>
          {totalPages > 1 && (
            <div class="flex items-center justify-center gap-4 mt-6 mb-10">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page <= 0}
                class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-secondary/50 text-xs font-medium hover:bg-secondary/80 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                <ChevronLeft class="h-3.5 w-3.5" /> Precedent
              </button>
              <span class="text-xs text-muted-foreground">{page + 1} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-secondary/50 text-xs font-medium hover:bg-secondary/80 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                Suivant <ChevronRight class="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

interface Props {
  genre: string;
  displayName: string;
}

function GenreContent({ genre, displayName }: Props) {
  const searchGenres = genreMap[genre] || [];
  const genreParam = searchGenres.join(',') || '';
  const [activeTab, setActiveTab] = useState<MediaType>('film');

  return (
    <div class="container mx-auto px-6 py-10">
      <header class="mb-8">
        <div class="flex items-center gap-4 mb-2">
          <h1 class="text-3xl md:text-4xl font-black italic uppercase tracking-tighter text-white">{displayName}</h1>
        </div>
        <p class="text-muted-foreground">Explorez les contenus du genre {displayName.toLowerCase()}.</p>
        <div class="w-16 h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent mt-4" />
      </header>

      <div class="flex flex-wrap gap-2 mb-8">
        {MEDIA_TABS.map(({ type, label }) => (
          <GenreTab key={type} type={type} label={label} genreParam={genreParam}
            isActive={activeTab === type} onSelect={() => setActiveTab(type)} />
        ))}
      </div>

      <TypeContent key={activeTab} type={activeTab} label={MEDIA_TABS.find(t => t.type === activeTab)!.label} genreParam={genreParam} />
    </div>
  );
}

export function GenreGrid(props: Props) {
  return (
    <QueryClientProvider client={queryClient}>
      <GenreContent {...props} />
    </QueryClientProvider>
  );
}
