const STORAGE_KEY = 'wm_adblock_detected';
const TIMEOUT_MS = 2000;

function randomToken(): string {
  return Math.random().toString(36).slice(2, 10);
}

function checkCosmetic(token: string): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = `ad-banner-${token}`;
    el.style.cssText = 'position:absolute;left:-9999px;height:1px;width:1px;pointer-events:none';
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      const cs = getComputedStyle(el);
      const blocked = el.offsetHeight === 0 || cs.display === 'none' || cs.visibility === 'hidden';
      el.remove();
      resolve(blocked);
    });
  });
}

function checkNetwork(): Promise<boolean> {
  return new Promise((resolve) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => { ctrl.abort(); resolve(true); }, TIMEOUT_MS);
    fetch('https://pagead2.googlesyndication.com/pagead/show_ads.js', {
      method: 'HEAD', mode: 'no-cors', signal: ctrl.signal,
    })
      .then(() => { clearTimeout(timer); resolve(false); })
      .catch(() => { clearTimeout(timer); resolve(true); });
  });
}

function checkResource(): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(true), TIMEOUT_MS);
    img.onload = () => { clearTimeout(timer); resolve(false); };
    img.onerror = () => { clearTimeout(timer); resolve(true); };
    img.src = `https://www.google-analytics.com/collect?v=1&t=event&_t=${randomToken()}`;
  });
}

export async function detectAdBlocker(): Promise<boolean> {
  const cached = sessionStorage.getItem(STORAGE_KEY);
  if (cached !== null) return cached === 'true';

  const token = randomToken();
  const [cosmetic, network, resource] = await Promise.all([
    checkCosmetic(token),
    checkNetwork(),
    checkResource(),
  ]);

  let signals = 0;
  if (cosmetic) signals++;
  if (network) signals++;
  if (resource) signals++;

  const detected = signals >= 2;
  try { sessionStorage.setItem(STORAGE_KEY, String(detected)); } catch {}
  return detected;
}

export function clearDetectionCache(): void {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
}
