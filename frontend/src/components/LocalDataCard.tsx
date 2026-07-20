import { Trash2 } from 'lucide-react';

interface Props {
  onClearFavorites: () => void;
  onClearWatchlist: () => void;
}

export function LocalDataCard({ onClearFavorites, onClearWatchlist }: Props) {
  return (
    <div className="p-5 rounded-2xl bg-secondary/15 border border-border/40">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-secondary/50 flex items-center justify-center">
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="text-sm font-semibold text-foreground">Donnees locales</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onClearFavorites} className="flex-1 h-10 rounded-xl text-sm font-medium bg-secondary/50 border border-border hover:bg-secondary/80 transition-all cursor-pointer">
          Vider les favoris
        </button>
        <button type="button" onClick={onClearWatchlist} className="flex-1 h-10 rounded-xl text-sm font-medium bg-secondary/50 border border-border hover:bg-secondary/80 transition-all cursor-pointer">
          Vider la watchlist
        </button>
      </div>
    </div>
  );
}
