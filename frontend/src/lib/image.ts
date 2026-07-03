const TMDB_RE = /image\.tmdb\.org\/t\/p\/\w+\//;
const GOOGLE_BOOKS_RE = /books\.google\.com/;
const ANILIST_RE = /anilist\.co/;

export function optimizePosterUrl(url?: string): string | undefined {
  if (!url) return undefined;

  if (TMDB_RE.test(url)) {
    return url.replace(/\/t\/p\/\w+\//, '/t/p/original/');
  }

  if (GOOGLE_BOOKS_RE.test(url)) {
    return url.replace(/zoom=\d+/, 'zoom=6');
  }

  if (ANILIST_RE.test(url)) {
    return url;
  }

  return url;
}

export function posterSrcSet(url?: string): string | undefined {
  if (!url || !TMDB_RE.test(url)) return undefined;

  const sizes: [string, number][] = [['w342',342],['w500',500],['w780',780],['original',1200]];
  return sizes.map(([s, w]) => `${url.replace(/\/t\/p\/\w+\//, `/t/p/${s}/`)} ${w}w`).join(', ');
}
