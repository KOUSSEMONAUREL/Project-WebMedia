export function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const data = (err as { data?: { message?: unknown } }).data;
    if (data && typeof data.message === 'string' && data.message.trim()) {
      return data.message;
    }
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

export function isBlockedError(err: unknown): boolean {
  const message = errorMessage(err).toLowerCase();
  return (
    message.includes('403') ||
    message.includes('forbidden') ||
    message.includes('cloudflare') ||
    message.includes('challenge')
  );
}
