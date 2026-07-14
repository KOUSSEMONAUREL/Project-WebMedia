const STORAGE_KEY = 'wm_adblock_detected';
const TIMEOUT_MS = 2500;

const AD_DOMAINS = ['quge5.com', 'elderlygoal.com', 'effectivecpmnetwork.com'];

function token(): string {
  return Math.random().toString(36).slice(2, 10);
}

function checkCosmetic(t: string): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = `ad-banner-${t}`;
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

function checkBaitScript(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = `https://${AD_DOMAINS[0]}/baid/${token()}.js`;
    s.onerror = () => resolve(true);
    s.onload = () => resolve(false);
    document.head.appendChild(s);
    setTimeout(() => resolve(true), TIMEOUT_MS);
  });
}

function checkOwnAds(): Promise<boolean> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const found = AD_DOMAINS.some((d) =>
        document.querySelector(`script[src*="${d}"], img[src*="${d}"]`),
      );
      resolve(!found);
    }, 600);
  });
}

export async function detectAdBlocker(): Promise<boolean> {
  const cached = sessionStorage.getItem(STORAGE_KEY);
  if (cached !== null) return cached === 'true';

  const [cosmetic, baitScript, ownAds] = await Promise.all([
    checkCosmetic(token()),
    checkBaitScript(),
    checkOwnAds(),
  ]);

  let signals = 0;
  if (cosmetic) signals++;
  if (baitScript) signals++;
  if (ownAds) signals++;

  const detected = signals >= 2;
  try { sessionStorage.setItem(STORAGE_KEY, String(detected)); } catch {}
  return detected;
}

export function clearDetectionCache(): void {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
}
