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

function w(url: string): string {
  return `${WSRV_BASE}?url=${encodeURIComponent(url)}&output=webp`;
}

function wsrc(url: string, width: number): string {
  return `${WSRV_BASE}?url=${encodeURIComponent(url)}&output=webp&w=${width} ${width}w`;
}

export function optimizePosterUrl(url?: string): string | undefined {
  if (!url) return undefined;
  return w(sourceUrl(url));
}

export function posterSrcSet(url?: string): string | undefined {
  if (!url) return undefined;
  const sizes = [342, 500, 780, 1200];
  return sizes.map((w_) => wsrc(sourceUrl(url), w_)).join(', ');
}

export function proxyImage(url?: string): string | undefined {
  if (!url) return undefined;
  return w(sourceUrl(url));
}
