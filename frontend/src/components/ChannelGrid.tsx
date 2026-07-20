import { Tv, Loader2 } from 'lucide-react';

type StreamStatus = 'unknown' | 'checking' | 'alive' | 'dead';

function flagEmoji(code: string): string {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(
    ...code.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
  );
}

function StatusDot({ status }: { status: StreamStatus }) {
  if (status === 'unknown') return <span className="w-2 h-2 rounded-full bg-muted-foreground/30 inline-block" title="Non verifie" />;
  if (status === 'checking') return <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />;
  if (status === 'alive') return <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" title="Actif" />;
  return <span className="w-2 h-2 rounded-full bg-red-500 inline-block" title="Inactif" />;
}

interface StreamInfo { url: string; quality: string | null; }
interface LiveChannel {
  id: string; name: string; logo: string; country: string;
  categories: string[]; streams: StreamInfo[];
}

interface Props {
  channels: LiveChannel[];
  statusMap: Record<string, StreamStatus>;
  onSelect: (channel: LiveChannel) => void;
}

export function ChannelGrid({ channels, statusMap, onSelect }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {channels.map(ch => (
        <button
          key={ch.id}
          type="button"
          onClick={() => onSelect(ch)}
          className={`group bg-card hover:bg-card/80 border rounded-xl p-4 text-left transition-all hover:shadow-[var(--glow-blue-subtle)] ${
            statusMap[ch.id] === 'alive'
              ? 'border-emerald-500/30 hover:border-emerald-500/50'
              : statusMap[ch.id] === 'dead'
              ? 'border-red-500/20 opacity-60'
              : 'border-border hover:border-primary/50'
          }`}
        >
          <div className="w-full aspect-video bg-muted rounded-lg mb-3 flex items-center justify-center overflow-hidden">
            {ch.logo ? (
              <img src={ch.logo} alt={ch.name} className="w-full h-full object-contain p-2" loading="lazy"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <Tv className="w-8 h-8 text-muted-foreground" />
            )}
          </div>
          <h3 className="text-sm font-medium truncate group-hover:text-primary transition-colors">{ch.name}</h3>
          <div className="flex items-center gap-2 mt-1">
            {ch.country && (
              <span className="text-xs text-muted-foreground flex items-center gap-1" title={ch.country}>
                {flagEmoji(ch.country)}
              </span>
            )}
            <StatusDot status={statusMap[ch.id] || 'unknown'} />
            <span className="text-xs text-muted-foreground">{ch.streams.length} flux</span>
          </div>
        </button>
      ))}
    </div>
  );
}
