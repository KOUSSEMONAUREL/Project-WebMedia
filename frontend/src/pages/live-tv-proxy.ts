import type { APIRoute } from 'astro';

const MAX_UPSTREAM_MS = 30_000;

function isPublicHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa')) {
    return false;
  }
  if (h.includes(':')) {
    const ip6 = h.indexOf('[') === 0 ? h.slice(1, -1) : h;
    if (
      ip6 === '::1' ||
      ip6.startsWith('fc') || ip6.startsWith('fd') ||
      ip6.startsWith('fe80') ||
      ip6 === '::' ||
      ip6.startsWith('::ffff:127.') ||
      ip6.startsWith('::ffff:10.')
    ) {
      return false;
    }
    return true;
  }
  const parts = h.split('.');
  if (parts.some((p) => !/^\d+$/.test(p)) || parts.length !== 4) return true;
  const [a, b] = parts.map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 192 && b === 168) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 192 && b === 0) return false;
  return true;
}

function proxyUrl(abs: string, origin: string): string {
  return `${origin}/live-tv-proxy?url=${encodeURIComponent(abs)}`;
}

function rewriteLine(line: string, base: URL, origin: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return line.replace(/URI="([^"]*)"/g, (_m, uri: string) => {
      try {
        return `URI="${proxyUrl(new URL(uri, base).href, origin)}"`;
      } catch {
        return _m;
      }
    });
  }
  try {
    return proxyUrl(new URL(trimmed, base).href, origin);
  } catch {
    return line;
  }
}

export const GET: APIRoute = async ({ request, url }) => {
  const target = url.searchParams.get('url');
  if (!target) return new Response('missing url', { status: 400 });

  let upstream: URL;
  try {
    upstream = new URL(target);
  } catch {
    return new Response('invalid url', { status: 400 });
  }
  if (!/^https?:$/.test(upstream.protocol)) return new Response('scheme not allowed', { status: 400 });
  if (!isPublicHost(upstream.hostname)) return new Response('host not allowed', { status: 400 });

  const hasRange = request.headers.has('range');
  const headers = new Headers();
  if (hasRange) headers.set('range', request.headers.get('range')!);
  headers.set('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36');
  headers.set('accept', '*/*');

  let up: Response;
  try {
    up = await fetch(upstream.href, { headers, redirect: 'follow', signal: AbortSignal.timeout(MAX_UPSTREAM_MS) });
  } catch {
    return new Response('upstream unreachable', { status: 502 });
  }
  if (!up.ok) return new Response(up.statusText, { status: up.status });

  const ctype = up.headers.get('content-type') || '';
  if (hasRange) {
    const out = new Headers({
      'access-control-allow-origin': '*',
      'content-type': ctype || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    const cr = up.headers.get('content-range');
    const ar = up.headers.get('accept-ranges');
    if (cr) out.set('content-range', cr);
    if (ar) out.set('accept-ranges', ar);
    return new Response(up.body, { status: up.status, headers: out });
  }

  const isPlaylist =
    /mpegurl|hls/i.test(ctype) ||
    /\.m3u8?$/i.test(upstream.pathname);

  if (isPlaylist) {
    const text = await up.text();
    const base = new URL(up.url || upstream.href);
    const origin = url.origin;
    const rewritten = text
      .split(/\r?\n/)
      .map((line) => rewriteLine(line, base, origin))
      .join('\n');
    return new Response(rewritten, {
      headers: {
        'access-control-allow-origin': '*',
        'content-type': 'application/vnd.apple.mpegurl',
        'cache-control': 'no-store',
      },
    });
  }

  return new Response(up.body, {
    headers: {
      'access-control-allow-origin': '*',
      'content-type': ctype || 'application/octet-stream',
      'cache-control': 'no-store',
    },
  });
};