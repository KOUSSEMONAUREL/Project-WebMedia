import { memo, type ReactNode, useState, useEffect } from 'react';
import { Star, Play, Heart, BookmarkPlus } from 'lucide-react';
import type { Media } from '@/lib/api';
import { optimizePosterUrl, posterSrcSet } from '@/lib/image';
import { isFavorite, addFavorite, removeFavorite, isInWatchlist, addToWatchlist, removeFromWatchlist } from '../lib/indexeddb';

const typeLabel: Record<string, string> = {
  film:    'Film',
  serie:   'Série',
  anime:   'Animé',
  jeu:     'Jeu',
  webtoon: 'Webtoon',
  book:    'Livre',
  novel:   'Novel',
};

const typeColors: Record<string, string> = {
  film:    'bg-sky-600',
  serie:   'bg-violet-600',
  anime:   'bg-rose-600',
  jeu:     'bg-emerald-600',
  webtoon: 'bg-amber-600',
  book:    'bg-orange-600',
  novel:   'bg-teal-600',
};

const typeGradients: Record<string, string> = {
  film:    'from-sky-950/60 via-sky-900/30 to-card',
  serie:   'from-violet-950/60 via-violet-900/30 to-card',
  anime:   'from-rose-950/60 via-rose-900/30 to-card',
  jeu:     'from-emerald-950/60 via-emerald-900/30 to-card',
  webtoon: 'from-amber-950/60 via-amber-900/30 to-card',
  book:    'from-orange-950/60 via-orange-900/30 to-card',
  novel:   'from-teal-950/60 via-teal-900/30 to-card',
};

const typeLabelUpper: Record<string, string> = {
  film:    'FILM',
  serie:   'SERIE',
  anime:   'ANIME',
  jeu:     'JEU',
  webtoon: 'WEBTOON',
  book:    'LIVRE',
  novel:   'NOVEL',
};

const typeIcons: Record<string, ReactNode> = {
  film: (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="2.5"/>
      <line x1="8" y1="2" x2="8" y2="22"/><line x1="16" y1="2" x2="16" y2="22"/>
      <line x1="2" y1="8" x2="22" y2="8"/><line x1="2" y1="16" x2="22" y2="16"/>
    </svg>
  ),
  serie: (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="7" width="20" height="15" rx="2"/>
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
    </svg>
  ),
  anime: (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 14.4c0 .9-.8 1.6-1.6 1.6H12l-4 5V0h12.4c.9 0 1.6.7 1.6 1.6V14.4z"/>
      <line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="14" y2="12"/>
    </svg>
  ),
  jeu: (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/>
      <line x1="15" y1="12" x2="15.01" y2="12"/><line x1="18" y1="10" x2="18.01" y2="10"/>
      <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59l-1.02 8A2 2 0 0 0 3.66 19h16.68a2 2 0 0 0 1.978-2.41l-1.02-8A4 4 0 0 0 17.32 5z"/>
    </svg>
  ),
  webtoon: (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 1 4 19.5z"/>
      <line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="14" y2="11"/>
      <line x1="8" y1="15" x2="16" y2="15"/>
    </svg>
  ),
  book: (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
      <line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="14" y2="11"/>
    </svg>
  ),
  novel: (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      <line x1="8" y1="7" x2="14" y2="13"/>
    </svg>
  ),
};

interface MediaCardProps {
  media: Media;
  size?: 'normal' | 'large';
}

export const MediaCard = memo(function MediaCard({ media, size = 'normal' }: MediaCardProps) {
  const detailHref = `/${media.type}/${media.slug || media.id}`;
  const isLarge = size === 'large';

  const [isFav, setIsFav] = useState(false);
  const [isWl, setIsWl] = useState(false);

  useEffect(() => {
    let active = true;
    async function checkStatus() {
      try {
        const fav = await isFavorite(media.id);
        const wl = await isInWatchlist(media.id);
        if (active) {
          setIsFav(fav);
          setIsWl(wl);
        }
      } catch (err) {
        try {
          const storedFavs = JSON.parse(localStorage.getItem('webmedia_favorites') || '[]');
          const storedWl = JSON.parse(localStorage.getItem('webmedia_watchlist') || '[]');
          if (active) {
            setIsFav(storedFavs.includes(media.id));
            setIsWl(storedWl.includes(media.id));
          }
        } catch {}
      }
    }
    checkStatus();
    return () => { active = false; };
  }, [media.id]);

  const toggleFavorite = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const nextVal = !isFav;
    setIsFav(nextVal);

    try {
      // 1. Écriture immédiate dans IndexedDB (locale, instantanée)
      if (nextVal) {
        await addFavorite({
          id: media.id,
          type: media.type,
          title: media.title,
          slug: media.slug || media.id,
          posterUrl: media.posterUrl,
          rating: media.rating,
          year: media.year
        });
      } else {
        await removeFavorite(media.id);
      }

      // 2. File d'attente différée → Supabase seulement après 15 min de session
      const { queueFavoriteSync } = await import('../lib/sync-queue');
      queueFavoriteSync(media.id, nextVal ? 'add' : 'remove');

    } catch (err) {
      console.warn('[toggle-favorite] erreur locale:', err);
      try {
        const stored = localStorage.getItem('webmedia_favorites');
        const favs: string[] = stored ? JSON.parse(stored) : [];
        const idx = favs.indexOf(media.id);
        if (nextVal) { if (idx === -1) favs.push(media.id); }
        else          { if (idx !== -1) favs.splice(idx, 1); }
        localStorage.setItem('webmedia_favorites', JSON.stringify(favs));
      } catch {}
    }
  };

  const toggleWatchlist = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const nextVal = !isWl;
    setIsWl(nextVal);

    try {
      if (nextVal) {
        await addToWatchlist({
          id: media.id,
          type: media.type,
          title: media.title,
          slug: media.slug || media.id,
          posterUrl: media.posterUrl,
          rating: media.rating,
          year: media.year
        });
      } else {
        await removeFromWatchlist(media.id);
      }
    } catch (err) {
      console.warn('[watchlist] local error:', err);
      try {
        const stored = localStorage.getItem('webmedia_watchlist');
        const wl: string[] = stored ? JSON.parse(stored) : [];
        const idx = wl.indexOf(media.id);
        if (nextVal) {
          if (idx === -1) wl.push(media.id);
        } else {
          if (idx !== -1) wl.splice(idx, 1);
        }
        localStorage.setItem('webmedia_watchlist', JSON.stringify(wl));
      } catch {}
    }
  };

  return (
    <a
      href={detailHref}
      className={`group relative flex flex-col gap-2 flex-shrink-0 poster-row-card transition-all duration-300 hover:-translate-y-1 hover:scale-[1.02] ${
        isLarge
          ? 'w-[130px] xs:w-[148px] sm:w-[180px] md:w-[200px] lg:w-[212px]'
          : 'w-[120px] xs:w-[138px] sm:w-[160px] md:w-[180px] lg:w-[192px]'
      }`}
    >
      {/* Poster */}
      <div
        className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-secondary shadow-md transition-all duration-300 group-hover:shadow-xl group-hover:ring-1 group-hover:ring-primary/20"
        style={{ border: '1px solid rgba(255,255,255,0.06)' }}
      >
        {media.posterUrl ? (
          <img
            src={optimizePosterUrl(media.posterUrl)!}
            srcSet={posterSrcSet(media.posterUrl)}
            sizes="(max-width: 640px) 164px, (max-width: 1024px) 192px, 212px"
            alt={media.title}
            className="relative z-10 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.08]"
            loading="lazy"
            onError={(e) => (e.target as HTMLImageElement).style.display = 'none'}
          />
        ) : null}

        {/* Placeholder (shown when no image or image behind it) */}
        <div className={`absolute inset-0 flex flex-col items-center justify-center p-5 text-center bg-gradient-to-br ${typeGradients[media.type] || 'from-card to-secondary/80'}`}>
          {/* Decorative circles */}
          <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-white/[0.03]"></div>
          <div className="absolute -bottom-4 -left-4 w-16 h-16 rounded-full bg-white/[0.02]"></div>

          {/* Type icon */}
          <div className="relative mb-3 opacity-30">
            {typeIcons[media.type] || null}
          </div>

          <span className="relative text-white/25 text-[9px] font-bold uppercase tracking-[0.15em] mb-2">
            {typeLabelUpper[media.type] || media.type.toUpperCase()}
          </span>
          <span className="relative text-white/60 text-sm font-display font-bold leading-snug line-clamp-6 px-1 drop-shadow-sm">
            {media.title}
          </span>
        </div>

        {/* Hover overlay */}
        <div className="absolute inset-0 z-20 bg-gradient-to-t from-black/85 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-end pb-3.5 px-3 gap-2">
          <button
            className="flex items-center gap-1.5 px-5 py-1.5 rounded-full text-[11px] font-bold text-black transform translate-y-3 group-hover:translate-y-0 transition-transform duration-300 shadow-lg"
            style={{ background: 'linear-gradient(135deg, #60a5fa, #3b82f6)' }}
          >
            <Play className="h-3 w-3 fill-current" />
            Détails
          </button>
          <div className="flex gap-1.5 transform translate-y-3 group-hover:translate-y-0 transition-all duration-300">
            <button
              onClick={toggleFavorite}
              className={`flex items-center gap-1 border px-3 py-1 rounded-full text-white transition-all ${
                isFav
                  ? 'border-red-500/80 bg-red-500/25 text-red-400 hover:bg-red-500/35'
                  : 'border-white/20 hover:border-red-500/60 hover:bg-red-500/20'
              }`}
              title="Favoris"
            >
              <Heart className={`h-3 w-3 ${isFav ? 'fill-red-500 text-red-500' : ''}`} />
            </button>
            <button
              onClick={toggleWatchlist}
              className={`flex items-center gap-1 border px-3 py-1 rounded-full text-white transition-all ${
                isWl
                  ? 'border-primary/80 bg-primary/25 text-primary hover:bg-primary/35'
                  : 'border-white/20 hover:border-primary/60 hover:bg-primary/15'
              }`}
              title="À voir"
            >
              <BookmarkPlus className={`h-3 w-3 ${isWl ? 'fill-primary text-primary' : ''}`} />
            </button>
          </div>
        </div>

        {/* Rating badge */}
        <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5 bg-black/65 backdrop-blur-sm px-1.5 py-0.5 rounded-md text-primary">
          <Star className="h-2.5 w-2.5 fill-current" />
          <span className="text-[11px] font-bold">{media.rating}</span>
        </div>

        {/* Type badge */}
        <div className={`absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/55 backdrop-blur-sm text-[9px] font-bold text-white/80 uppercase tracking-wider`}>
          {typeLabel[media.type] || media.type}
        </div>
      </div>

      {/* Info */}
      <div className="flex flex-col gap-1 px-0.5">
        <h3 className="font-display font-semibold text-[14px] leading-snug text-foreground group-hover:text-primary transition-colors duration-200 line-clamp-2">
          {media.title}
        </h3>
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span>{media.year}</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase text-white ${typeColors[media.type] || 'bg-gray-600'}`}>
            {typeLabel[media.type] || media.type}
          </span>
          <span className="flex items-center gap-0.5 text-primary ml-auto">
            <Star className="h-3 w-3 fill-current" />
            {media.rating}
          </span>
        </div>
      </div>
    </a>
  );
});
