import { useState, useEffect, useRef } from 'react';
import { Search, Star, Command } from 'lucide-react';
import { proxyImage } from '@/lib/image';
import type { Media } from '@/lib/types';

const typeColors: Record<string, string> = {
  film:    'bg-sky-700',
  serie:   'bg-violet-700',
  anime:   'bg-rose-700',
  jeu:     'bg-emerald-700',
  webtoon: 'bg-amber-700',
  comic:   'bg-blue-700',
  book:    'bg-orange-700',
  novel:   'bg-teal-700',
};

interface Props {
  typeFilter: string | null;
}

export function NavbarSearch({ typeFilter }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Media[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const isMac = typeof navigator !== 'undefined' ? /Mac|iPod|iPhone|iPad/.test(navigator.platform) : false;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(function() {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (searchQuery.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      const { searchMedia } = await import('@/lib/api');
      const res = await searchMedia(searchQuery, typeFilter ? { type: typeFilter as any } : undefined);
      setSuggestions(res.data?.slice(0, 6) || []);
      setShowSuggestions(true);
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery, typeFilter]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative w-28 sm:w-36 md:w-44 lg:w-36 xl:w-48 focus-within:w-36 focus-within:sm:w-48 focus-within:md:w-60 focus-within:lg:w-56 focus-within:xl:w-72 transition-all duration-200 shrink-0" ref={searchRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => searchQuery.length >= 2 && setShowSuggestions(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && searchQuery.length >= 2) {
              const p = typeFilter ? `&type=${typeFilter}` : '';
              window.location.href = `/search?q=${encodeURIComponent(searchQuery)}${p}`;
            }
          }}
          maxLength={200}
          placeholder="Rechercher..."
          className="w-full h-9 bg-white/[0.04] border border-border/50 rounded-lg pl-9 pr-8 text-[13px] placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40 focus:bg-white/[0.06] focus:ring-1 focus:ring-primary/20 focus:shadow-[0_0_20px_rgba(59,130,246,0.08)] transition-all"
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden md:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium text-muted-foreground/40 border border-border/30">
          {isMac ? <><Command className="h-2.5 w-2.5" />K</> : <>Ctrl+K</>}
        </span>

        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-card/95 backdrop-blur-xl border border-border/60 rounded-xl shadow-2xl overflow-hidden z-50 animate-fade-in">
            {suggestions.map((item) => (
              <a
                key={item.id}
                href={`/${item.type}/${item.slug}`}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.04] transition-colors border-b border-border/20 last:border-0"
                onClick={() => { setShowSuggestions(false); setSearchQuery(''); }}
              >
                <img
                  src={proxyImage(item.posterUrl)}
                  alt={item.title}
                  className="w-8 h-12 object-cover rounded-md shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[13px] text-foreground truncate">{item.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase text-white ${typeColors[item.type] || 'bg-gray-600'}`}>
                      {item.type}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{item.year}</span>
                    <span className="flex items-center text-[11px] text-primary gap-0.5 ml-auto">
                      <Star className="h-2.5 w-2.5 fill-current" />
                      {item.rating}
                    </span>
                  </div>
                </div>
              </a>
            ))}
            <a
              href={`/search?q=${encodeURIComponent(searchQuery)}${typeFilter ? `&type=${typeFilter}` : ''}`}
              className="block px-3 py-2.5 text-center text-[12px] text-primary font-medium hover:bg-white/[0.04] transition-colors border-t border-border/20"
              onClick={() => { setShowSuggestions(false); setSearchQuery(''); }}
            >
              Voir tous les resultats pour &ldquo;{searchQuery}&rdquo;
            </a>
          </div>
        )}

        {showSuggestions && searchQuery.length >= 2 && suggestions.length === 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-card/95 backdrop-blur-xl border border-border/60 rounded-xl shadow-2xl p-4 text-center z-50 animate-fade-in">
            <p className="text-muted-foreground text-[13px]">Aucun resultat pour &ldquo;{searchQuery}&rdquo;</p>
          </div>
        )}
      </div>
    </div>
  );
}
