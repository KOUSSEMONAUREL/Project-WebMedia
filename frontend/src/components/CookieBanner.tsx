import { useState, useEffect } from 'react';

const CONSENT_KEY = 'webmedia_storage_consent';

export function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(CONSENT_KEY)) {
      setVisible(true);
    }
  }, []);

  const dismiss = (choice: 'full' | 'minimal') => {
    localStorage.setItem(CONSENT_KEY, choice);
    if (choice === 'full' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(function(reg) {
        console.log('[SW] registered:', reg.scope);
      }).catch(function(err) {
        console.warn('[SW] registration failed:', err);
      });
    }
    setHiding(true);
    setTimeout(function() { setVisible(false); }, 250);
  };

  return (
    <div
      role="dialog"
      aria-label="Stockage local"
      className={
        'fixed bottom-0 left-0 right-0 z-[999] transition-all duration-250 ' +
        (!visible ? 'invisible' : hiding ? 'opacity-0 translate-y-full' : 'opacity-100 translate-y-0')
      }
    >
      <div className="mx-auto max-w-3xl px-4 py-3">
        <div className="rounded-xl border border-white/8 bg-[#111318] shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
          <div className="flex items-center justify-between gap-4 px-4 py-2.5">
            <p className="text-[12px] text-white/50 leading-relaxed">
              Donnees locales (favoris, watchlist, session) et protection anti-bot Cloudflare Turnstile.
              <button
                onClick={function() {
                  var e = document.getElementById('cookie-details');
                  if (e) e.style.display = e.style.display === 'block' ? 'none' : 'block';
                }}
                className="ml-1.5 text-white/40 hover:text-white/60 underline decoration-dotted underline-offset-2"
              >
                Details
              </button>
            </p>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={function() { dismiss('minimal'); }}
                className="px-2.5 py-1.5 rounded-lg text-[11px] text-white/40 hover:text-white/60 transition-colors"
              >
                Refuser
              </button>
              <button
                onClick={function() { dismiss('full'); }}
                className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-white/10 hover:bg-white/14 text-white/80 transition-all"
              >
                Accepter
              </button>
            </div>
          </div>
          <div id="cookie-details" className="hidden border-t border-white/5 px-4 py-2">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/35">
              <span>Session (necessaire)</span>
              <span>Favoris & watchlist (IndexedDB)</span>
              <span>Cache hors-ligne (optionnel)</span>
              <span className="w-full mt-1 text-white/25 leading-relaxed">
                Regies pubs : Monetag, HilltopAds, Adsterra &ndash; voir <a href="/legal" className="text-blue-400 hover:underline">mentions legales</a>
              </span>
              <span className="w-full mt-1 text-white/25 leading-relaxed">
                Protection anti-bot Cloudflare Turnstile &ndash; <a href="https://www.cloudflare.com/en-gb/turnstile-privacy-policy/" target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-white/40">Politique Cloudflare</a>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
