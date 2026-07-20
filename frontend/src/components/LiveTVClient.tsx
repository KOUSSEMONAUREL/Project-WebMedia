import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Search, Tv, Loader2, X, AlertCircle, Wifi, WifiOff, Radio } from 'lucide-react';
import Hls from 'hls.js';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import { saveLivetvCache, loadLivetvCache, saveStreamCheck, loadStreamChecksBatch } from '../lib/livetv-db';

const CHANNELS_URL = 'https://iptv-org.github.io/api/channels.json';
const STREAMS_URL = 'https://iptv-org.github.io/api/streams.json';
const PER_PAGE = 20;
const MAX_CONCURRENT_CHECKS = 5;
const CHECK_TIMEOUT = 8000;

type StreamStatus = 'unknown' | 'checking' | 'alive' | 'dead';

function flagEmoji(code: string): string {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(
    ...code.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
  );
}



interface StreamInfo { url: string; quality: string | null; }
interface LiveChannel {
  id: string; name: string; logo: string; country: string;
  categories: string[]; streams: StreamInfo[];
}

const checkQueue: { url: string; resolve: (alive: boolean) => void }[] = [];
let runningChecks = 0;

function pumpQueue() {
  while (runningChecks < MAX_CONCURRENT_CHECKS && checkQueue.length > 0) {
    const item = checkQueue.shift()!;
    runningChecks++;
    doCheck(item.url).then(alive => {
      runningChecks--;
      item.resolve(alive);
      saveStreamCheck(item.url, alive);
      pumpQueue();
    });
  }
}

async function doCheck(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Range: 'bytes=0-511' },
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const text = await res.text();
    return text.startsWith('#EXTM3U');
  } catch {
    return false;
  }
}

function enqueueCheck(url: string): Promise<boolean> {
  return new Promise(resolve => {
    checkQueue.push({ url, resolve });
    pumpQueue();
  });
}

function StatusDot({ status }: { status: StreamStatus }) {
  if (status === 'unknown') return <span className="w-2 h-2 rounded-full bg-muted-foreground/30 inline-block" title="Non verifie" />;
  if (status === 'checking') return <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />;
  if (status === 'alive') return <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" title="Actif" />;
  return <span className="w-2 h-2 rounded-full bg-red-500 inline-block" title="Inactif" />;
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {Array.from({ length: PER_PAGE }).map((_, i) => (
        <div key={i} className="bg-card rounded-xl p-4 border border-border animate-pulse">
          <div className="w-full aspect-video bg-muted rounded-lg mb-3" />
          <div className="h-4 bg-muted rounded w-3/4 mb-2" />
          <div className="h-3 bg-muted rounded w-1/3" />
        </div>
      ))}
    </div>
  );
}

function PlayerModal({ channel, onClose }: {
  channel: LiveChannel; onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const plyrRef = useRef<Plyr | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [streamIndex, setStreamIndex] = useState(0);

  const streamUrl = channel.streams[streamIndex]?.url;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) { setStatus('error'); return; }
    setStatus('loading');

    const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
    hlsRef.current = hls;
    hls.loadSource(streamUrl);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      setStatus('ready');
      if (!plyrRef.current) {
        plyrRef.current = new Plyr(video, {
          controls: ['play-large','play','progress','current-time','mute','volume','fullscreen'],
          muted: true,
        });
      }
      video.play().catch(() => {});
    });

    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) setStatus('error');
    });

    return () => {
      if (plyrRef.current) { plyrRef.current.destroy(); plyrRef.current = null; }
      if (hlsRef.current) {
        hlsRef.current.off(Hls.Events.MANIFEST_PARSED);
        hlsRef.current.off(Hls.Events.ERROR);
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamUrl]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-5xl overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            {channel.logo && (
              <img src={channel.logo} alt="" className="w-8 h-8 object-contain rounded flex-shrink-0"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <h2 className="font-semibold truncate">{channel.name}</h2>
            {channel.country && (
              <span className="text-lg flex-shrink-0" title={channel.country}>{flagEmoji(channel.country)}</span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {channel.streams.length > 1 && (
              <select
                aria-label="Selectionner le flux"
                value={streamIndex}
                onChange={e => setStreamIndex(Number(e.target.value))}
                className="text-xs bg-muted border border-border rounded-lg px-2 py-1"
              >
                {channel.streams.map((s, i) => (
                  <option key={s.url} value={i}>{s.quality || `Flux ${i + 1}`}</option>
                ))}
              </select>
            )}
            <button type="button" aria-label="Fermer le lecteur" onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="relative bg-black aspect-video">
          <video ref={videoRef} className="w-full h-full" playsInline crossOrigin="anonymous">
            <track kind="captions" src="" label="Sous-titres" />
          </video>
          {status === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          )}
          {status === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <div className="text-center">
                <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Flux indisponible</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function LiveTVClient() {
  const [allChannels, setAllChannels] = useState<LiveChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [category, setCategory] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'name-desc' | 'streams'>('name');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<LiveChannel | null>(null);
  const [aliveOnly, setAliveOnly] = useState(false);
  const [channelStatus, setChannelStatus] = useState<Record<string, StreamStatus>>({});
  const gridRef = useRef<HTMLDivElement>(null);
  const checkingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await loadLivetvCache('channels');
      if (cached && !cancelled) {
        setAllChannels(cached);
        setLoading(false);
        return;
      }
      try {
        const [channelsRes, streamsRes] = await Promise.all([
          fetch(CHANNELS_URL),
          fetch(STREAMS_URL),
        ]);
        if (!channelsRes.ok || !streamsRes.ok) throw new Error('Fetch failed');
        const channels: any[] = await channelsRes.json();
        const streams: any[] = await streamsRes.json();

        const streamMap = new Map<string, StreamInfo[]>();
        for (const s of streams) {
          if (!s.channel || !s.url) continue;
          if (!streamMap.has(s.channel)) streamMap.set(s.channel, []);
          streamMap.get(s.channel)!.push({ url: s.url, quality: s.quality });
        }

        const merged: LiveChannel[] = [];
        for (const ch of channels) {
          const chStreams = streamMap.get(ch.id);
          if (!chStreams || chStreams.length === 0) continue;
          merged.push({
            id: ch.id,             name: ch.name, logo: ch.logo || '', country: ch.country || '',
            categories: ch.categories || [],
            streams: chStreams,
          });
        }

        if (!cancelled) {
          setAllChannels(merged);
          setLoading(false);
          saveLivetvCache('channels', merged);
        }
      } catch (err: any) {
        if (!cancelled) { setError(err.message); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const c of allChannels) {
      if (c.country) set.add(c.country);
    }
    return Array.from(set).sort();
  }, [allChannels]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const ch of allChannels) {
      for (const cat of ch.categories) set.add(cat);
    }
    return Array.from(set).sort();
  }, [allChannels]);

  const filtered = useMemo(() => {
    let result = allChannels;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c => c.name.toLowerCase().includes(q));
    }
    if (country) result = result.filter(c => c.country === country);
    if (category) result = result.filter(c => c.categories.includes(category));
    if (sortBy === 'name') result.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'name-desc') result.sort((a, b) => b.name.localeCompare(a.name));
    else if (sortBy === 'streams') result.sort((a, b) => b.streams.length - a.streams.length);
    return result;
  }, [allChannels, search, country, category, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const pageChannels = filtered.slice(safePage * PER_PAGE, (safePage + 1) * PER_PAGE);

  const visibleChannels = useMemo(() => {
    if (!aliveOnly) return pageChannels;
    return pageChannels.filter(ch => {
      const s = channelStatus[ch.id];
      return s === 'alive' || s === 'checking';
    });
  }, [pageChannels, aliveOnly, channelStatus]);

  const verifyingCount = useMemo(() =>
    Object.values(channelStatus).filter(s => s === 'checking').length,
  [channelStatus]);

  useEffect(() => {
    if (!allChannels.length || loading) return;
    let cancelled = false;

    (async () => {
      const urlsToCheck: { chId: string; url: string }[] = [];
      const statusUpdates: Record<string, StreamStatus> = {};

      const statusResults = await Promise.all(pageChannels.map(async (ch) => {
        const cached = await loadStreamChecksBatch(ch.streams.map(s => s.url));
        let hasAlive = false;
        let hasDead = false;
        for (const s of ch.streams) {
          const r = cached.get(s.url);
          if (r === true) hasAlive = true;
          else if (r === false) hasDead = true;
        }
        let status: StreamStatus;
        if (hasAlive) {
          status = 'alive';
        } else if (hasDead && ch.streams.every(s => cached.get(s.url) === false)) {
          status = 'dead';
        } else {
          status = 'checking';
          for (const s of ch.streams) {
            if (!cached.has(s.url)) urlsToCheck.push({ chId: ch.id, url: s.url });
          }
        }
        return { chId: ch.id, status };
      }));

      for (const { chId, status } of statusResults) {
        statusUpdates[chId] = status;
      }

      if (!cancelled) setChannelStatus(prev => ({ ...prev, ...statusUpdates }));
      if (!urlsToCheck.length || cancelled) return;

      const results = await Promise.allSettled(
        urlsToCheck.map(({ chId, url }) =>
          enqueueCheck(url).then(alive => ({ chId, url, alive }))
        )
      );

      if (cancelled) return;
      const newStatus = { ...statusUpdates };
      const channelMap = new Map(pageChannels.map(ch => [ch.id, ch]));
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const { chId, alive } = result.value;
        const ch = channelMap.get(chId);
        if (!ch) continue;
        const cur = newStatus[chId];
        if (cur === 'alive') continue;
        if (alive) {
          newStatus[chId] = 'alive';
        } else {
          const allDead = ch.streams.every(s => {
            const r = urlsToCheck.find(u => u.url === s.url && u.chId === chId);
            return r ? false : true;
          });
          if (allDead) newStatus[chId] = 'dead';
        }
      }
      if (!cancelled) setChannelStatus(prev => ({ ...prev, ...newStatus }));
    })();

    return () => { cancelled = true; };
  }, [allChannels, loading, safePage]);

  const goToPage = useCallback((p: number) => {
    if (p < 0 || p >= totalPages) return;
    setPage(p);
    gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [totalPages]);

  useEffect(() => { setPage(0); }, [search, country, category, sortBy]);

  const pageNumbers = useMemo(() => {
    const cur = safePage + 1;
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | string)[] = [1];
    const start = Math.max(2, cur - 2);
    const end = Math.min(totalPages - 1, cur + 2);
    if (start > 2) pages.push('...');
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < totalPages - 1) pages.push('...');
    pages.push(totalPages);
    return pages;
  }, [safePage, totalPages]);

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-col items-center justify-center p-12 bg-card rounded-xl border border-border">
          <AlertCircle className="w-12 h-12 text-destructive mb-4" />
          <p className="text-lg font-medium mb-2">Erreur de chargement</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8" ref={gridRef}>
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">TV en Direct</h1>
        <p className="text-muted-foreground">
          {loading ? 'Chargement...' : `${filtered.length} chaines disponibles`}
        </p>
      </div>

      <div className="bg-card border border-border rounded-2xl p-4 mb-6 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text" placeholder="Rechercher une chaine..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Pays"
            value={country} onChange={e => setCountry(e.target.value)}
            className="flex-1 min-w-[140px] px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          >
            <option value="">Tous les pays</option>
            {countries.map(c => (
              <option key={c} value={c}>{flagEmoji(c)} {c}</option>
            ))}
          </select>
          <select
            aria-label="Categorie"
            value={category} onChange={e => setCategory(e.target.value)}
            className="flex-1 min-w-[140px] px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          >
            <option value="">Toutes les categories</option>
            {categories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            aria-label="Trier par"
            value={sortBy} onChange={e => setSortBy(e.target.value as any)}
            className="min-w-[120px] px-3 py-2 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          >
            <option value="name">Nom A-Z</option>
            <option value="name-desc">Nom Z-A</option>
            <option value="streams">Plus de sources</option>
          </select>
          <button
            type="button"
            onClick={() => setAliveOnly(!aliveOnly)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-all ${
              aliveOnly
                ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400'
                : 'bg-muted/50 border-border hover:border-primary/50'
            }`}
            title="Afficher uniquement les chaines dont les flux sont actifs"
          >
            {aliveOnly ? <Wifi className="w-4 h-4" /> : <Radio className="w-4 h-4" />}
            <span className="hidden sm:inline">{aliveOnly ? 'Actifs' : 'Verifier'}</span>
            {verifyingCount > 0 && (
              <Loader2 className="w-3 h-3 animate-spin" />
            )}
          </button>
        </div>
      </div>

      {loading ? (
        <SkeletonGrid />
      ) : visibleChannels.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-card rounded-xl border border-border">
          <Tv className="w-12 h-12 text-muted-foreground mb-4" />
          <p className="text-lg font-medium mb-2">Aucune chaine trouvee</p>
          <p className="text-sm text-muted-foreground">Essayez de modifier vos filtres</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {visibleChannels.map(ch => (
              <button
                key={ch.id}
                type="button"
                onClick={() => setSelected(ch)}
                className={`group bg-card hover:bg-card/80 border rounded-xl p-4 text-left transition-all hover:shadow-[var(--glow-blue-subtle)] ${
                  channelStatus[ch.id] === 'alive'
                    ? 'border-emerald-500/30 hover:border-emerald-500/50'
                    : channelStatus[ch.id] === 'dead'
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
                  <StatusDot status={channelStatus[ch.id] || 'unknown'} />
                  <span className="text-xs text-muted-foreground">{ch.streams.length} flux</span>
                </div>
              </button>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 mt-8">
              <button
                type="button"
                onClick={() => goToPage(safePage - 1)}
                disabled={safePage === 0}
                className="px-3 py-1.5 text-sm rounded-lg bg-card border border-border disabled:opacity-30 hover:border-primary/50 transition-colors"
              >
                Prev
              </button>
              {pageNumbers.map((p, i) =>
                typeof p === 'string' ? (
                  <span key={`e${i}`} className="px-2 text-muted-foreground">...</span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => goToPage(p - 1)}
                    className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                      p === safePage + 1
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card border-border hover:border-primary/50'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                type="button"
                onClick={() => goToPage(safePage + 1)}
                disabled={safePage >= totalPages - 1}
                className="px-3 py-1.5 text-sm rounded-lg bg-card border border-border disabled:opacity-30 hover:border-primary/50 transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {selected && (
        <PlayerModal channel={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
