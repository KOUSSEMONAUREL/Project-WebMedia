import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LiveTVGrid } from './LiveTVGrid';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export function LiveTVClient() {
  const handleSelect = (channel: any) => {
    const encoded = encodeURIComponent(channel.id);
    window.location.href = `/watch-tv/${encoded}`;
  };

  return (
    <QueryClientProvider client={queryClient}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">TV en Direct</h1>
          <p className="text-muted-foreground">
            Chaines du monde entier depuis iptv-org
          </p>
        </div>
        <LiveTVGrid onSelectChannel={handleSelect} />
      </div>
    </QueryClientProvider>
  );
}
