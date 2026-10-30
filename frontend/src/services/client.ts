import { AUTH_API_BASE, PUBLIC_API_BASE } from '../lib/endpoints';

const cache = new Map<string, { data: any; expiry: number }>();
const CACHE_TTL = 60000;

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiry) return entry.data as T;
  cache.delete(key);
  return null;
}

function setCache(key: string, data: any, ttl: number = CACHE_TTL) {
  if (cache.size >= 100) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(key, { data, expiry: Date.now() + ttl });
}

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public path?: string
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function apiGet<T = any>(
  endpoint: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  let url = `${PUBLIC_API_BASE}${endpoint}`;

  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        searchParams.set(key, String(value));
      }
    }
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
  }

  const cached = getCached<T>(url);
  if (cached) return cached;

  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try { const errBody: any = await res.json(); if (errBody?.error) msg = errBody.error; } catch {}
    throw new ApiRequestError(res.status, msg, endpoint);
  }

  const data: T = await res.json();
  setCache(url, data);
  return data;
}

export async function apiPost<T = any>(
  endpoint: string,
  body: any = {},
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const url = `${AUTH_API_BASE}${endpoint}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders };

  if (!headers.Authorization) {
    try {
      const { getAuthToken } = await import('../lib/auth-client');
      const token = await getAuthToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {}
  }

  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try { const errBody: any = await res.json(); if (errBody?.error) msg = errBody.error; } catch {}
    throw new ApiRequestError(res.status, msg, endpoint);
  }

  return res.json() as Promise<T>;
}