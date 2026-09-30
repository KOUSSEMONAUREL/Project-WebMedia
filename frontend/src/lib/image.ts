const ANILIST_RE = /anilist\.co/;
const MANGADEX_RE = /uploads\.mangadex\.org/;
const TMDB_RE = /image\.tmdb\.org\/t\/p\/\w+\//;
const GOOGLE_BOOKS_RE = /books\.google\.com/;
// wsrv.nl answers 400 "Domain or TLD blocked by policy" for this host, while
// the origin serves it fine, so comics must bypass the proxy too.
const COMICVINE_RE = /comicvine\.gamespot\.com/;
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
    return (
        ANILIST_RE.test(url) ||
        MANGADEX_RE.test(url) ||
        TMDB_RE.test(url) ||
        COMICVINE_RE.test(url)
    );
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
  const src = sourceUrl(url);
  if (bypassProxy(src)) return src;
  return `${w(src)}&w=342`;
}

export function posterSrcSet(url?: string): string | undefined {
  if (!url) return undefined;
  const sizes = [342, 500, 780, 1200];
  const set = sizes.flatMap((w_) => {
    const src = wsrc(sourceUrl(url), w_);
    return src ? [src] : [];
  }).join(', ');
  return set || undefined;
}

export function proxyImage(url?: string): string | undefined {
  if (!url) return undefined;
  return w(sourceUrl(url));
}