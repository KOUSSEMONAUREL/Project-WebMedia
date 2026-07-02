import { memo } from 'react';
import { Star, Play, Heart, BookmarkPlus } from 'lucide-react';
import type { Media } from '@/lib/api';

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

interface MediaCardProps {
  media: Media;
  size?: 'normal' | 'large';
}

export const MediaCard = memo(function MediaCard({ media, size = 'normal' }: MediaCardProps) {
  const detailHref = `/${media.type}/${media.slug || media.id}`;
  const isLarge = size === 'large';

  const toggleFavorite = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const stored = localStorage.getItem('webmedia_favorites');
    const favs: string[] = stored ? JSON.parse(stored) : [];
    const idx = favs.indexOf(media.id);
    if (idx === -1) favs.push(media.id); else favs.splice(idx, 1);
    localStorage.setItem('webmedia_favorites', JSON.stringify(favs));
  };

  const toggleWatchlist = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const stored = localStorage.getItem('webmedia_watchlist');
    const wl: string[] = stored ? JSON.parse(stored) : [];
    const idx = wl.indexOf(media.id);
    if (idx === -1) wl.push(media.id); else wl.splice(idx, 1);
    localStorage.setItem('webmedia_watchlist', JSON.stringify(wl));
  };

  return (
    <a
      href={detailHref}
      className={`group relative flex flex-col gap-2 flex-shrink-0 poster-row-card transition-all duration-300 hover:-translate-y-2 hover:scale-[1.02] ${
        isLarge
          ? 'w-[180px] sm:w-[212px]'
          : 'w-[164px] sm:w-[192px]'
      }`}
    >
      {/* Poster */}
      <div
        className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-secondary shadow-md transition-all duration-300 group-hover:shadow-xl group-hover:ring-1 group-hover:ring-primary/20"
        style={{ border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <img
          src={media.posterUrl}
          alt={media.title}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.08]"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).src = 'https://via.placeholder.com/300x450?text=?'; }}
        />

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-end pb-3.5 px-3 gap-2">
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
              className="flex items-center gap-1 border border-white/20 hover:border-red-500/60 hover:bg-red-500/20 px-3 py-1 rounded-full text-white transition-all"
              title="Favoris"
            >
              <Heart className="h-3 w-3" />
            </button>
            <button
              onClick={toggleWatchlist}
              className="flex items-center gap-1 border border-white/20 hover:border-primary/60 hover:bg-primary/15 px-3 py-1 rounded-full text-white transition-all"
              title="À voir"
            >
              <BookmarkPlus className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Rating badge */}
        <div className="absolute top-2 right-2 flex items-center gap-0.5 bg-black/65 backdrop-blur-sm px-1.5 py-0.5 rounded-md text-primary">
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
