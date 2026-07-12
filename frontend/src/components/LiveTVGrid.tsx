import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Tv, Loader2, AlertCircle, Globe } from 'lucide-react';

const API_URL = (import.meta.env.PUBLIC_API_URL || 'http://localhost:8787').replace(/\/+$/, '') + '/api';

interface Channel {
  id: string;
  name: string;
  logo: string;
  country: string;
  languages: string[];
  categories: string[];
  streamCount: number;
}

interface LiveTVGridProps {
  onSelectChannel: (channel: Channel) => void;
}

const COUNTRY_FLAGS: Record<string, string> = {
  FR: '🇫🇷', US: '🇺🇸', GB: '🇬🇧', DE: '🇩🇪', IT: '🇮🇹',
  ES: '🇪🇸', PT: '🇵🇹', BR: '🇧🇷', CA: '🇨🇦', AU: '🇦🇺',
  JP: '🇯🇵', KR: '🇰🇷', CN: '🇨🇳', IN: '🇮🇳', RU: '🇷🇺',
  NL: '🇳🇱', BE: '🇧🇪', CH: '🇨🇭', TN: '🇹🇳', DZ: '🇩🇿',
  MA: '🇲🇦', SN: '🇸🇳', CI: '🇨🇮', CM: '🇨🇲', CD: '🇨🇩',
};

function getFlag(country: string): string {
  return COUNTRY_FLAGS[country] || '';
}

export function LiveTVGrid({ onSelectChannel }: LiveTVGridProps) {
  const [search, setSearch] = useState('');
  const [countryFilter, setCountryFilter] = useState('');

  const { data, isPending, isError } = useQuery({
    queryKey: ['livetv-channels'],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '500' });
      if (search) params.set('q', search);
      if (countryFilter) params.set('country', countryFilter);
      const res = await fetch(`${API_URL}/livetv?${params}`);
      if (!res.ok) throw new Error('Failed to fetch channels');
      const json = await res.json();
      return json.data as Channel[];
    },
    staleTime: 120_000,
    gcTime: 300_000,
  });

  const countries = useQuery({
    queryKey: ['livetv-countries'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/livetv?limit=500`);
      if (!res.ok) return [];
      const json = await res.json();
      const chs = json.data as Channel[];
      const countrySet = new Set(chs.filter(c => c.country).map(c => c.country));
      return Array.from(countrySet).sort();
    },
    staleTime: 300_000,
  });

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-card rounded-xl border border-border">
        <AlertCircle className="w-12 h-12 text-destructive mb-4" />
        <p className="text-lg font-medium text-foreground mb-2">Erreur de chargement</p>
        <p className="text-sm text-muted-foreground">Impossible de charger les chaines TV</p>
      </div>
    );
  }

  const channels = data || [];

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Rechercher une chaine..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          />
        </div>
        <select
          value={countryFilter}
          onChange={e => setCountryFilter(e.target.value)}
          className="px-4 py-2.5 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
        >
          <option value="">Tous les pays</option>
          {countries.data?.map(c => (
            <option key={c} value={c}>{getFlag(c)} {c}</option>
          ))}
        </select>
      </div>

      {isPending ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="bg-card rounded-xl p-4 border border-border animate-pulse">
              <div className="w-full aspect-video bg-muted rounded-lg mb-3" />
              <div className="h-4 bg-muted rounded w-3/4 mb-2" />
              <div className="h-3 bg-muted rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : channels.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-card rounded-xl border border-border">
          <Tv className="w-12 h-12 text-muted-foreground mb-4" />
          <p className="text-lg font-medium text-foreground mb-2">Aucune chaine trouvee</p>
          <p className="text-sm text-muted-foreground">Essayez de modifier vos filtres de recherche</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {channels.map(channel => (
            <button
              key={channel.id}
              onClick={() => onSelectChannel(channel)}
              className="group bg-card hover:bg-card/80 border border-border rounded-xl p-4 text-left transition-all hover:border-primary/50 hover:shadow-[var(--glow-blue-subtle)]"
            >
              <div className="w-full aspect-video bg-muted rounded-lg mb-3 flex items-center justify-center overflow-hidden">
                {channel.logo ? (
                  <img
                    src={channel.logo}
                    alt={channel.name}
                    className="w-full h-full object-contain p-2"
                    loading="lazy"
                    onError={e => {
                      (e.target as HTMLImageElement).src = '';
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <Tv className="w-8 h-8 text-muted-foreground" />
                )}
              </div>
              <h3 className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                {channel.name}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                {channel.country && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    {getFlag(channel.country) || <Globe className="w-3 h-3" />}
                    {channel.country}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {channel.streamCount} flux
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
