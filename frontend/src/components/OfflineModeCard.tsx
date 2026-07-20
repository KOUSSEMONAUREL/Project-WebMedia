import { Wifi, WifiOff } from 'lucide-react';

interface Props {
  enabled: boolean;
  onToggle: () => void;
  cacheCleared: boolean;
  onClearCache: () => void;
}

export function OfflineModeCard({ enabled, onToggle, cacheCleared, onClearCache }: Props) {
  return (
    <div className="p-5 rounded-2xl bg-secondary/15 border border-border/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-secondary/50 flex items-center justify-center">
            {enabled
              ? <Wifi className="h-4 w-4 text-blue-400" />
              : <WifiOff className="h-4 w-4 text-muted-foreground" />}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Mode hors-ligne</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {enabled ? 'Cache active' : 'Cache desactive'}
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? 'Desactiver le mode hors-ligne' : 'Activer le mode hors-ligne'}
          onClick={onToggle}
          className={`relative w-11 h-6 rounded-full border transition-all duration-300 cursor-pointer ${
            enabled ? 'bg-blue-600 border-blue-500' : 'bg-secondary border-border'
          }`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-300 ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`} />
        </button>
      </div>
      {enabled && (
        <div className="mt-4 pt-4 border-t border-border/30 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Vider le cache</p>
          <button
            type="button"
            onClick={onClearCache}
            className="text-xs font-medium text-muted-foreground hover:text-red-400 px-3 py-1.5 rounded-lg border border-border hover:border-red-500/30 transition-all cursor-pointer"
          >
            {cacheCleared ? 'Cache vide' : 'Vider'}
          </button>
        </div>
      )}
    </div>
  );
}
