import { useState, useEffect } from 'react';
import { Wifi } from 'lucide-react';

const CONSENT_KEY = 'webmedia_storage_consent';

export function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(CONSENT_KEY)) {
      setTimeout(() => setVisible(true), 600);
    }
  }, []);

  const dismiss = (choice: 'full' | 'minimal') => {
    localStorage.setItem(CONSENT_KEY, choice);
    if (choice === 'full' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    } else if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
      caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
    }
    setHiding(true);
    setTimeout(() => setVisible(false), 300);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Préférences de stockage"
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[999] w-full max-w-xl px-4 transition-all duration-300 ${
        hiding ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'
      }`}
    >
      <div className="rounded-xl border border-white/8 bg-[#111318]/90 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
        <div className="px-4 py-3.5">
          <div className="flex items-start gap-3">

            {/* Pastille */}
            <div className="mt-[1px] shrink-0 w-6 h-6 rounded-md bg-blue-500/10 border border-blue-500/15 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-blue-400" />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-[12.5px] font-medium text-white/90 leading-snug">
                Stockage local
              </p>
              <p className="text-[11.5px] text-white/45 mt-0.5 leading-relaxed">
                Le site utilise des cookies de session et stocke vos favoris sur votre appareil.
                Vous pouvez également activer le cache hors-ligne pour naviguer sans connexion.
              </p>

              {/* Tags discrets */}
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {['Session (nécessaire)', 'Favoris & watchlist (local)', 'Cache hors-ligne (optionnel)'].map((tag, i) => (
                  <span
                    key={tag}
                    className={`text-[10px] px-1.5 py-0.5 rounded-md ${
                      i < 2
                        ? 'bg-white/5 text-white/40'
                        : 'bg-blue-500/8 text-blue-400/70'
                    }`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-white/5">
            <button
              id="cookie-minimal"
              onClick={() => dismiss('minimal')}
              className="px-3 py-1.5 rounded-lg text-[11.5px] text-white/45 hover:text-white/70 transition-colors duration-150"
            >
              Sans cache
            </button>
            <button
              id="cookie-full"
              onClick={() => dismiss('full')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11.5px] font-medium bg-white/8 hover:bg-white/12 text-white/80 hover:text-white border border-white/8 transition-all duration-150"
            >
              <Wifi className="w-3 h-3" />
              Accepter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
