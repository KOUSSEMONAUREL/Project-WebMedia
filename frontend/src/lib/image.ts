const ANILIST_RE = /anilist\.co/;
const MANGADEX_RE = /uploads\.mangadex\.org/;
const TMDB_RE = /image\.tmdb\.org\/t\/p\/\w+\//;
const GOOGLE_BOOKS_RE = /books\.google\.com/;
const WSRV_BASE = 'https://wsrv.nl/';

function sourceUrl(url: string): string {
  if (TMDB_RE.test(url)) {
    return url.replace(/\/t\/p\/\w+\//, '/t/p/original/');
  }
  if (GOOGLE_BOOKS_RE.test(url)) {
    return url.replace(/zoom=\d+/, 'zoom=6');
  }
  return url;
}

function bypassProxy(url: string): boolean {
  return ANILIST_RE.test(url) || MANGADEX_RE.test(url);
}

function w(url: string): string {
  if (bypassProxy(url)) return url;
  return `${WSRV_BASE}?url=${encodeURIComponent(url)}&output=webp`;
}

function wsrc(url: string, width: number): string {
  if (bypassProxy(url)) return '';
  return `${WSRV_BASE}?url=${encodeURIComponent(url)}&output=webp&w=${width} ${width}w`;
}

export function optimizePosterUrl(url?: string): string | undefined {
  if (!url) return undefined;
  return w(sourceUrl(url));
}

export function posterSrcSet(url?: string): string | undefined {
  if (!url) return undefined;
  const sizes = [342, 500, 780, 1200];
  const set = sizes.map((w_) => wsrc(sourceUrl(url), w_)).filter(Boolean).join(', ');
  return set || undefined;
}

export function proxyImage(url?: string): string | undefined {
  if (!url) return undefined;
  return w(sourceUrl(url));
}