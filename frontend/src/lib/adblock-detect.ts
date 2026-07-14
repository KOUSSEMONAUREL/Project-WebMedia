const STORAGE_KEY = 'wm_adblock_detected';
const DISMISS_KEY = 'wm_popup_dismissed';
const DISMISS_INTERVAL = 120_000;
const WHITELIST_INTERVAL = 300_000;

export function setDismissed(): void {
  try { sessionStorage.setItem(DISMISS_KEY, `d:${Date.now()}`); } catch {}
}

export function setWhitelistPending(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.setItem(DISMISS_KEY, `w:${Date.now()}`);
  } catch {}
}

function isInCooldown(): boolean {
  const raw = sessionStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const [mode, ts] = raw.split(':');
  const interval = mode === 'w' ? WHITELIST_INTERVAL : DISMISS_INTERVAL;
  return Date.now() - Number(ts) < interval;
}

export async function detectAdBlocker(): Promise<boolean> {
  const prefilled = sessionStorage.getItem(STORAGE_KEY);
  if (prefilled !== null) return prefilled === 'true';

  const s = document.createElement('script');
  s.src = 'https://quge5.com/bait/detect.js?' + Math.random();
  const bait = new Promise<boolean>((r) => {
    s.onerror = () => r(true);
    s.onload = () => r(false);
    document.head.appendChild(s);
    setTimeout(() => r(true), 3000);
  });

  const content = new Promise<boolean>((r) => {
    setTimeout(() => {
      const domains = ['quge5.com', 'elderlygoal.com', 'effectivecpmnetwork.com'];
      const found = domains.some((d) =>
        document.querySelector(`script[src*="${d}"]`),
      );
      const iframes = document.querySelectorAll('iframe').length;
      r(found && iframes <= 1);
    }, 4000);
  });

  const [baitResult, contentResult] = await Promise.all([bait, content]);

  const inline = sessionStorage.getItem(STORAGE_KEY);
  if (inline !== null) return inline === 'true';

  const detected = baitResult && contentResult;
  try { sessionStorage.setItem(STORAGE_KEY, String(detected)); } catch {}
  return detected;
}

export function shouldShowPopup(): boolean {
  if (isInCooldown()) return false;
  const blocked = sessionStorage.getItem(STORAGE_KEY);
  return blocked === 'true';
}

export function clearDetectionCache(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(DISMISS_KEY);
  } catch {}
}
