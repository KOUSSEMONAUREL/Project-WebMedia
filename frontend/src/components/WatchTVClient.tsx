import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LiveTVPlayer } from './LiveTVPlayer';
import { Loader2, AlertCircle } from 'lucide-react';

const API_URL = (import.meta.env.PUBLIC_API_URL || 'http://localhost:8787').replace(/\/+$/, '') + '/api';

export function WatchTVClient() {
  const [channelId, setChannelId] = useState('');

  useEffect(() => {
    const id = window.location.pathname.split('/watch-tv/')[1];
    if (id) setChannelId(decodeURIComponent(id));
  }, []);

  const { data, isPending, isError } = useQuery({
    queryKey: ['livetv-stream', channelId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/livetv/stream/${encodeURIComponent(channelId)}`);
      if (!res.ok) throw new Error('Channel not found');
      return res.json();
    },
    enabled: !!channelId,
    staleTime: 60_000,
  });

  const channel = data?.data;

  const handleBack = () => {
    window.location.href = '/live-tv';
  };

  if (!channelId || isPending) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !channel) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4 bg-card p-8 rounded-xl border border-border">
          <AlertCircle className="w-12 h-12 text-destructive" />
          <p className="text-lg font-medium">Chaine introuvable</p>
          <button onClick={handleBack} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm">
            Retour aux chaines
          </button>
        </div>
      </div>
    );
  }

  const streamUrl = channel.streams?.[0]?.url;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <LiveTVPlayer
        streamUrl={streamUrl || ''}
        channelName={channel.name}
        channelLogo={channel.logo}
        onBack={handleBack}
      />
      {channel.streams && channel.streams.length > 1 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">Autres flux disponibles</h3>
          <div className="flex flex-wrap gap-2">
            {channel.streams.slice(1).map((s: any, i: number) => (
              <a
                key={i}
                href={`/watch-tv/${encodeURIComponent(channelId)}?quality=${s.quality || i}`}
                className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs hover:border-primary/50 transition-colors"
              >
                {s.quality || `Flux ${i + 2}`}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
