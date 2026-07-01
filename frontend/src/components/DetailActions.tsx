import { useState, useEffect } from 'react';
import { Heart, Clock, HeartOff, ClockOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DetailActionsProps {
    mediaId: string;
}

export function DetailActions({ mediaId }: DetailActionsProps) {
    const [isFav, setIsFav] = useState(false);
    const [isWatchlist, setIsWatchlist] = useState(false);

    useEffect(() => {
        setIsFav(checkList('webmedia_favorites', mediaId));
        setIsWatchlist(checkList('webmedia_watchlist', mediaId));
    }, [mediaId]);

    const checkList = (key: string, id: string): boolean => {
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored).includes(id) : false;
    };

    const toggleList = (key: string, id: string, current: boolean, setter: (v: boolean) => void) => {
        const stored = localStorage.getItem(key);
        const list: string[] = stored ? JSON.parse(stored) : [];
        if (current) {
            list.splice(list.indexOf(id), 1);
        } else {
            list.push(id);
        }
        localStorage.setItem(key, JSON.stringify(list));
        setter(!current);
    };

    return (
        <div className="flex flex-wrap gap-3">
            <button
                onClick={() => toggleList('webmedia_favorites', mediaId, isFav, setIsFav)}
                className={cn(
                    "group flex items-center gap-2 px-6 py-3 rounded-full font-semibold text-sm transition-all duration-300",
                    isFav
                        ? "bg-red-500/20 text-red-400 border border-red-500/30"
                        : "glass-light text-muted-foreground hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10"
                )}
            >
                {isFav ? <HeartOff className="h-4 w-4" /> : <Heart className="h-4 w-4" />}
                {isFav ? "Favori" : "Favoris"}
            </button>
            <button
                onClick={() => toggleList('webmedia_watchlist', mediaId, isWatchlist, setIsWatchlist)}
                className={cn(
                    "group flex items-center gap-2 px-6 py-3 rounded-full font-semibold text-sm transition-all duration-300",
                    isWatchlist
                        ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                        : "glass-light text-muted-foreground hover:text-blue-400 hover:border-blue-500/30 hover:bg-blue-500/10"
                )}
            >
                {isWatchlist ? <ClockOff className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                {isWatchlist ? "Dans la liste" : "À voir"}
            </button>
        </div>
    );
}
