export function resolveHttpUrl(value: string | undefined, baseUrl: string): string {
  const raw = value?.trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function isIngestableUrl(value: string | undefined): boolean {
  const raw = value?.trim();
  if (!raw) return false;
  if (raw.startsWith('magnet:')) return true;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
