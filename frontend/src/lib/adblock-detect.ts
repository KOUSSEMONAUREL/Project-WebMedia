const STORAGE_KEY = 'wm_adblock_detected';
const DISMISS_KEY = 'wm_popup_dismissed';
const POPUP_INTERVAL = 120_000;
const AD_DOMAINS = ['quge5.com', 'elderlygoal.com', 'effectivecpmnetwork.com'];

function t(): string {
  return Math.random().toString(36).slice(2, 10);
}

function checkBaitScript(domain: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = `https://${domain}/bait/${t()}.js`;
    s.onerror = () => resolve(true);
    s.onload = () => resolve(false);
    document.head.appendChild(s);
    setTimeout(() => resolve(true), 3000);
  });
}

function checkAdContent(): Promise<boolean> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const scriptsFound = AD_DOMAINS.some((d) =>
        document.querySelector(`script[src*="${d}"]`),
      );
      const iframes = document.querySelectorAll('iframe').length;
      const blocked = scriptsFound && iframes <= 1;
      resolve(blocked);
    }, 4000);
  });
}

function isInCooldown(): boolean {
  const raw = sessionStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  return Date.now() - Number(raw) < POPUP_INTERVAL;
}

export function setDismissed(): void {
  try { sessionStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
}

export async function detectAdBlocker(): Promise<boolean> {
  const prefilled = sessionStorage.getItem(STORAGE_KEY);
  if (prefilled !== null) return prefilled === 'true';

  const [b1, b2, adContent] = await Promise.all([
    checkBaitScript(AD_DOMAINS[0]),
    checkBaitScript(AD_DOMAINS[1]),
    checkAdContent(),
  ]);

  const afterCheck = sessionStorage.getItem(STORAGE_KEY);
  if (afterCheck !== null) return afterCheck === 'true';

  const detected = (b1 && b2) || adContent;
  try { sessionStorage.setItem(STORAGE_KEY, String(detected)); } catch {}
  return detected;
}

export function shouldShowPopup(): boolean {
  if (isInCooldown()) return false;
  const blocked = sessionStorage.getItem(STORAGE_KEY);
  if (blocked === null) return false;
  return blocked === 'true';
}

export function clearDetectionCache(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(DISMISS_KEY);
  } catch {}
}
