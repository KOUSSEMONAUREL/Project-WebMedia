import { Hono } from 'hono';

const IPTV_CHANNELS_URL = 'https://iptv-org.github.io/api/channels.json';
const IPTV_STREAMS_URL = 'https://iptv-org.github.io/api/streams.json';

interface IptvChannel {
  id: string;
  name: string;
  country: string;
  languages: string[];
  categories: string[];
  logo: string;
  is_nsfw: boolean;
}

interface IptvStream {
  channel: string | null;
  url: string;
  quality: string | null;
  user_agent: string | null;
  referrer: string | null;
}

export interface LiveChannel {
  id: string;
  name: string;
  logo: string;
  country: string;
  languages: string[];
  categories: string[];
  streams: { url: string; quality: string | null }[];
}

interface CacheEntry {
  data: LiveChannel[];
  timestamp: number;
}

let channelsCache: CacheEntry | null = null;
const CACHE_TTL = 5 * 60 * 1000;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

async function getChannels(): Promise<LiveChannel[]> {
  const now = Date.now();
  if (channelsCache && now - channelsCache.timestamp < CACHE_TTL) {
    return channelsCache.data;
  }

  const [channels, streams] = await Promise.all([
    fetchJson<IptvChannel[]>(IPTV_CHANNELS_URL),
    fetchJson<IptvStream[]>(IPTV_STREAMS_URL),
  ]);

  const streamMap = new Map<string, { url: string; quality: string | null }[]>();
  for (const s of streams) {
    if (!s.channel || !s.url) continue;
    if (!streamMap.has(s.channel)) streamMap.set(s.channel, []);
    streamMap.get(s.channel)!.push({ url: s.url, quality: s.quality });
  }

  const result: LiveChannel[] = [];
  for (const ch of channels) {
    const chStreams = streamMap.get(ch.id) || [];
    if (chStreams.length === 0) continue;
    result.push({
      id: ch.id,
      name: ch.name,
      logo: ch.logo || '',
      country: ch.country || '',
      languages: ch.languages || [],
      categories: ch.categories || [],
      streams: chStreams,
    });
  }

  channelsCache = { data: result, timestamp: now };
  return result;
}

interface Env {
  ENVIRONMENT?: string;
}

const livetvRoutes = new Hono<{ Bindings: Env }>();

livetvRoutes.get('/', async (c) => {
  try {
    const all = await getChannels();
    const query = c.req.query('q')?.toLowerCase();
    const group = c.req.query('group')?.toLowerCase();
    const country = c.req.query('country')?.toUpperCase();
    const lang = c.req.query('lang')?.toLowerCase();

    let filtered = all;
    if (query) {
      filtered = filtered.filter(ch => ch.name.toLowerCase().includes(query));
    }
    if (group) {
      filtered = filtered.filter(ch => ch.categories.some(c => c.toLowerCase().includes(group)));
    }
    if (country) {
      filtered = filtered.filter(ch => ch.country === country);
    }
    if (lang) {
      filtered = filtered.filter(ch => ch.languages.some(l => l.toLowerCase() === lang));
    }

    const limit = Math.min(parseInt(c.req.query('limit') || '100'), 200);
    const offset = parseInt(c.req.query('offset') || '0');

    const total = filtered.length;
    const page = filtered.slice(offset, offset + limit);

    return c.json({
      success: true,
      data: page.map(ch => ({
        id: ch.id,
        name: ch.name,
        logo: ch.logo,
        country: ch.country,
        languages: ch.languages,
        categories: ch.categories,
        streamCount: ch.streams.length,
      })),
      total,
    });
  } catch (err: any) {
    console.error('[livetv] Error fetching channels:', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

livetvRoutes.get('/stream/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const all = await getChannels();
    const channel = all.find(ch => ch.id === id);
    if (!channel) {
      return c.json({ success: false, error: 'Channel not found' }, 404);
    }
    return c.json({
      success: true,
      data: {
        id: channel.id,
        name: channel.name,
        logo: channel.logo,
        streams: channel.streams,
      },
    });
  } catch (err: any) {
    console.error('[livetv] Error fetching stream:', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

livetvRoutes.get('/groups', async (c) => {
  try {
    const all = await getChannels();
    const groups = new Set<string>();
    for (const ch of all) {
      for (const cat of ch.categories) {
        groups.add(cat);
      }
    }
    return c.json({
      success: true,
      data: Array.from(groups).sort(),
    });
  } catch (err: any) {
    console.error('[livetv] Error fetching groups:', err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

export default livetvRoutes;
