const STORAGE_KEY = 'wm_adblock_detected';
const DISMISS_KEY = 'wm_popup_dismissed';
const DISMISS_INTERVAL = 120_000;
const WHITELIST_INTERVAL = 300_000;

export function setDismissed(): void {
  try { sessionStorage.setItem(DISMISS_KEY, `d:${Date.now()}`); } catch { }
}

export function setWhitelistPending(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.setItem(DISMISS_KEY, `w:${Date.now()}`);
  } catch { }
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

  const baitEl = document.createElement('div');
  baitEl.className = 'adsbox pub_300x250 pub_300x250m pub_728x90 text-ad textAd ad-wrapper';
  baitEl.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;';
  document.body.appendChild(baitEl);

  const bait = new Promise<boolean>((r) => {
    setTimeout(() => {
      const hidden = baitEl.offsetParent === null || baitEl.offsetHeight === 0;
      baitEl.remove();
      r(hidden);
    }, 500);
  });

  const content = new Promise<boolean>((r) => {
    setTimeout(() => {
      const iframes = document.querySelectorAll('iframe').length;
      r(iframes <= 1);
    }, 500);
  });

  const [baitResult, contentResult] = await Promise.all([bait, content]);
  const detected = baitResult && contentResult;

  try { sessionStorage.setItem(STORAGE_KEY, String(detected)); } catch { }
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
  } catch { }
}