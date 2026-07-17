import { useState, useEffect, useCallback } from 'react';
import { MediaCard } from './MediaCard';
import { searchMedia, type Media } from '../lib/api';
import { Search, X, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const TYPES = [
  { value: 'all', label: 'Tout' },
  { value: 'film', label: 'Films' },
  { value: 'serie', label: 'Séries' },
  { value: 'anime', label: 'Animés' },
  { value: 'jeu', label: 'Jeux' },
  { value: 'webtoon', label: 'Webtoons' },
  { value: 'book', label: 'Livres' },
  { value: 'novel', label: 'Light Novels' },
];

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <div className="aspect-[2/3] skeleton rounded-xl" />
          <div className="h-4 skeleton rounded w-3/4" />
          <div className="h-3 skeleton rounded w-1/3" />
        </div>
      ))}
    </div>
  );
}

export default function SearchResults() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Media[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState('');
  const [activeType, setActiveType] = useState('all');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q') || '';
    const t = params.get('type') || 'all';
    setQuery(q);
    setActiveType(t);
    if (q.length >= 10) {
      performSearch(q, t);
    }
  }, []);

  const performSearch = useCallback(async (q: string, type: string) => {
    setIsLoading(true);
    setHasSearched(true);
    setError('');
    try {
      const res = await searchMedia(q, { type: type === 'all' ? undefined : type as any });
      setResults(res.data || []);
    } catch {
      setError('Erreur lors de la recherche.');
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim().length >= 10) {
      const url = new URL(window.location.href);
      url.searchParams.set('q', query.trim());
      if (activeType !== 'all') url.searchParams.set('type', activeType);
      else url.searchParams.delete('type');
      window.history.pushState({}, '', url.toString());
      performSearch(query.trim(), activeType);
    }
  };

  const handleTypeChange = (type: string) => {
    setActiveType(type);
    if (query.trim().length >= 10) {
      const url = new URL(window.location.href);
      url.searchParams.set('q', query.trim());
      if (type !== 'all') url.searchParams.set('type', type);
      else url.searchParams.delete('type');
      window.history.pushState({}, '', url.toString());
      performSearch(query.trim(), type);
    }
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setHasSearched(false);
    const url = new URL(window.location.href);
    url.search = '';
    window.history.pushState({}, '', url.toString());
  };

  return (
    <div className="container mx-auto px-6 pt-24 pb-16">
      {/* Header */}
      <header className="mb-8 animate-fade-in text-center md:text-left">
        <h1 className="text-4xl md:text-5xl font-display font-bold mb-2" style={{
          background: 'linear-gradient(135deg,#f0f4ff 0%,#60a5fa 50%,#3b82f6 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          Recherche
        </h1>
        <p className="text-muted-foreground text-sm">Trouvez vos films, séries, animés et plus encore.</p>
      </header>

      {/* Type filters */}
      <div className="flex flex-wrap gap-2 mb-6 animate-fade-in-up justify-center md:justify-start" style={{ animationDelay: '0.05s' }}>
        {TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => handleTypeChange(t.value)}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-medium transition-all duration-200",
              activeType === t.value
                ? "bg-primary/15 text-primary border border-primary/30 shadow-[0_0_16px_rgba(59,130,246,0.08)]"
                : "text-muted-foreground hover:text-foreground border border-transparent hover:border-border/40 hover:bg-white/[0.03]"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search input */}
      <form onSubmit={handleSubmit} className="relative max-w-2xl mx-auto md:mx-0 mb-8 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
        <div className="relative glass rounded-2xl overflow-hidden border border-white/[0.06] focus-within:border-primary/30 focus-within:shadow-[0_0_40px_rgba(59,130,246,0.10)] transition-all duration-300">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/60" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un titre..."
            className="w-full h-14 bg-transparent pl-14 pr-28 text-lg focus:outline-none text-foreground placeholder:text-muted-foreground/50"
          />
          {query && (
            <>
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-16 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg hover:bg-white/[0.06]"
              >
                <X className="h-5 w-5" />
              </button>
              <button
                type="submit"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-primary hover:text-primary/80 transition-colors p-2 rounded-lg hover:bg-primary/10"
              >
                <ArrowRight className="h-5 w-5" />
              </button>
            </>
          )}
        </div>
      </form>

      {/* Error */}
      {error && (
        <div className="glass rounded-2xl p-8 text-center mb-8">
          <p className="text-destructive font-medium">{error}</p>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && <SkeletonGrid />}

      {/* Results */}
      {!isLoading && hasSearched && !error && results.length > 0 && (
        <div className="animate-fade-in">
          <p className="text-sm text-muted-foreground mb-6">
            {results.length} résultat{results.length > 1 ? 's' : ''} pour "<span className="text-foreground font-medium">{query}</span>"
            {activeType !== 'all' && <span> dans <span className="text-primary capitalize">{activeType}s</span></span>}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 stagger-children">
            {results.map((media) => (
              <MediaCard key={media.id} media={media} />
            ))}
          </div>
        </div>
      )}

      {/* No results */}
      {!isLoading && hasSearched && !error && results.length === 0 && (
        <div className="glass rounded-2xl p-16 text-center max-w-lg mx-auto animate-fade-in">
          <div className="text-5xl mb-5 text-muted-foreground/50">&#128270;</div>
          <h3 className="text-xl font-display font-semibold text-foreground mb-2">Aucun résultat</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Aucun contenu trouvé pour "<span className="font-medium text-foreground">{query}</span>".
          </p>
          <p className="text-muted-foreground/60 text-xs mt-2">Essayez un autre terme ou vérifiez l'orthographe.</p>
        </div>
      )}

      {/* Initial state */}
      {!hasSearched && !isLoading && !error && (
        <div className="text-center py-24 animate-fade-in">
          <div className="text-6xl mb-6 text-muted-foreground/30">&#128269;</div>
          <p className="text-muted-foreground/70 text-base">
            Tapez un titre pour commencer.
          </p>
          <div className="flex items-center justify-center gap-5 mt-8 text-[12px] text-muted-foreground/40">
            {['Film','Série','Animé','Jeu','Livre','Webtoon'].map((t) => (
              <span key={t} className="px-3 py-1.5 rounded-full border border-border/20">{t}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
