const API_BASE_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3000/api';
const STORAGE_KEY_TOKEN = 'webmedia_token';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY_TOKEN);
}

export function setToken(token: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY_TOKEN, token);
}

export function clearToken() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY_TOKEN);
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
  withAuth = false
): Promise<T> {
  let url = `${API_BASE_URL}${endpoint}`;

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

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (withAuth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, { method: 'GET', headers });

  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try { const body = await res.json(); if (body?.error) msg = body.error; } catch {}
    throw new ApiRequestError(res.status, msg, endpoint);
  }

  return res.json();
}

export async function apiPost<T = any>(
  endpoint: string,
  body: any = {},
  withAuth = false
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (withAuth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });

  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try { const body = await res.json(); if (body?.error) msg = body.error; } catch {}
    throw new ApiRequestError(res.status, msg, endpoint);
  }

  return res.json();
}
