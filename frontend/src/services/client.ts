const API_BASE_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3000/api';

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

  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });

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
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try { const body = await res.json(); if (body?.error) msg = body.error; } catch {}
    throw new ApiRequestError(res.status, msg, endpoint);
  }

  return res.json();
}
