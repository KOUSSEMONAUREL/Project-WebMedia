import { Star, Play, Heart, BookmarkPlus } from 'lucide-react';
import type { Media } from '@/lib/api';

interface MediaCardProps {
    media: Media;
}

export function MediaCard({ media }: MediaCardProps) {
    const detailHref = `/${media.type}/${media.slug || media.id}`;

    const toggleFavorite = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const stored = localStorage.getItem('webmedia_favorites');
        const favs: string[] = stored ? JSON.parse(stored) : [];
        const idx = favs.indexOf(media.id);
        if (idx === -1) {
            favs.push(media.id);
        } else {
            favs.splice(idx, 1);
        }
        localStorage.setItem('webmedia_favorites', JSON.stringify(favs));
    };

    const toggleWatchlist = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const stored = localStorage.getItem('webmedia_watchlist');
        const wl: string[] = stored ? JSON.parse(stored) : [];
        const idx = wl.indexOf(media.id);
        if (idx === -1) {
            wl.push(media.id);
        } else {
            wl.splice(idx, 1);
        }
        localStorage.setItem('webmedia_watchlist', JSON.stringify(wl));
    };

    return (
        <a href={detailHref} className="group relative flex flex-col gap-3 transition-all duration-500 hover:-translate-y-2">
            <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl shadow-lg border border-white/5 group-hover:shadow-primary/20 group-hover:shadow-2xl transition-all duration-500">
                <img
                    src={media.posterUrl}
                    alt={media.title}
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).src = 'https://via.placeholder.com/300x450?text=?'; }}
                />

                <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] opacity-0 transition-opacity duration-500 group-hover:opacity-100 flex flex-col items-center justify-center gap-4">
                    <button className="flex items-center gap-2 bg-primary px-6 py-2.5 rounded-full text-black font-semibold text-sm transform translate-y-4 group-hover:translate-y-0 transition-transform duration-500 shadow-xl shadow-primary/30 hover:scale-105 hover:bg-white">
                        <Play className="h-4 w-4 fill-current" />
                        Détails
                    </button>
                    <div className="flex gap-2 transform translate-y-4 group-hover:translate-y-0 transition-all duration-700">
                        <button onClick={toggleFavorite} className="flex items-center gap-2 border border-white/30 hover:border-red-500 hover:bg-red-500/20 px-4 py-2 rounded-full text-white text-xs transition-all" title="Ajouter aux favoris">
                            <Heart className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={toggleWatchlist} className="flex items-center gap-2 border border-white/30 hover:border-blue-500 hover:bg-blue-500/20 px-4 py-2 rounded-full text-white text-xs transition-all" title="Ajouter à la watchlist">
                            <BookmarkPlus className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>

                <div className="absolute top-2 right-2 flex items-center bg-black/40 backdrop-blur-md px-2.5 py-1 rounded-full text-primary border border-white/10 shadow-sm">
                    <Star className="h-3 w-3 fill-current mr-1.5" />
                    <span className="text-xs font-semibold">{media.rating}</span>
                </div>

                <div className="absolute bottom-2 left-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white text-[10px] font-medium tracking-wide uppercase">
                    {media.type}
                </div>
            </div>

            <div className="flex flex-col gap-1 mt-1 px-1">
                <h3 className="font-display font-semibold text-xl leading-tight text-foreground transition-colors group-hover:text-primary line-clamp-2">
                    {media.title}
                </h3>
                <p className="text-xs text-muted-foreground font-light">{media.year}</p>
            </div>
        </a>
    );
}
