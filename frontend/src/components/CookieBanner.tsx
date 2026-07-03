import { useState, useEffect } from 'react';
import { Shield, Wifi, X, ChevronDown, ChevronUp } from 'lucide-react';

const CONSENT_KEY = 'webmedia_storage_consent';

type ConsentValue = 'full' | 'minimal' | null;

export function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (!stored) {
      setTimeout(() => setVisible(true), 800);
    }
  }, []);

  const dismiss = (choice: 'full' | 'minimal') => {
    localStorage.setItem(CONSENT_KEY, choice);

    if (choice === 'full') {
      // Enregistrer le SW si consentement complet
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      }
    } else {
      // Désinscrire tout SW actif si mode minimal
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((r) => r.unregister());
        });
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
      }
    }

    setLeaving(true);
    setTimeout(() => setVisible(false), 400);
  };

  if (!visible) return null;

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-[999] px-4 pb-4 pt-0 transition-all duration-400 ${
        leaving ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'
      }`}
    >
      <div className="max-w-3xl mx-auto">
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0d1117]/95 backdrop-blur-xl shadow-[0_-4px_40px_rgba(0,0,0,0.6)]">
          {/* Barre décorative top */}
          <div className="h-[2px] w-full bg-gradient-to-r from-blue-500/60 via-purple-500/60 to-teal-500/60" />

          <div className="p-5">
            <div className="flex items-start gap-4">
              {/* Icône */}
              <div className="shrink-0 mt-0.5 w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center">
                <Shield className="w-4 h-4 text-blue-400" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[14px] font-semibold text-white">
                    Stockage local & Service Worker
                  </h3>
                  <button
                    onClick={() => dismiss('minimal')}
                    className="shrink-0 p-1 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-white transition-colors"
                    aria-label="Fermer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed">
                  WebMedia utilise <strong className="text-white/80">des cookies de session</strong> (authentification, nécessaires) et stocke vos{' '}
                  <strong className="text-white/80">favoris, watchlist et historique localement</strong> sur votre appareil (données vous appartenant).
                  En option, un Service Worker peut mettre le site en cache pour une{' '}
                  <strong className="text-white/80">navigation hors-ligne</strong>.
                </p>

                {/* Détails extensibles */}
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="flex items-center gap-1 text-[11.5px] text-blue-400/80 hover:text-blue-400 mt-2 transition-colors"
                >
                  {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {expanded ? 'Masquer les détails' : 'Voir les détails'}
                </button>

                {expanded && (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {[
                      {
                        color: 'emerald',
                        label: 'Cookies de session',
                        desc: 'Connexion & authentification. Strictement nécessaires.',
                        required: true,
                      },
                      {
                        color: 'blue',
                        label: 'Stockage local (IndexedDB)',
                        desc: 'Vos favoris, watchlist et historique. Toujours sur votre appareil.',
                        required: true,
                      },
                      {
                        color: 'purple',
                        label: 'Cache hors-ligne (SW)',
                        desc: 'Pages et catalogue mis en cache pour une navigation sans réseau.',
                        required: false,
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className={`rounded-xl p-3 border ${
                          item.color === 'emerald'
                            ? 'bg-emerald-950/30 border-emerald-500/15'
                            : item.color === 'blue'
                            ? 'bg-blue-950/30 border-blue-500/15'
                            : 'bg-purple-950/30 border-purple-500/15'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold text-white/90">{item.label}</span>
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                              item.required
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-purple-500/20 text-purple-400'
                            }`}
                          >
                            {item.required ? 'Nécessaire' : 'Optionnel'}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-snug">{item.desc}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2 mt-4">
                  <button
                    id="cookie-accept-full"
                    onClick={() => dismiss('full')}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12.5px] font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-all duration-200 shadow-[0_2px_12px_rgba(59,130,246,0.35)]"
                  >
                    <Wifi className="w-3.5 h-3.5" />
                    Accepter (avec cache hors-ligne)
                  </button>
                  <button
                    id="cookie-accept-minimal"
                    onClick={() => dismiss('minimal')}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12.5px] font-medium border border-border hover:bg-white/[0.04] text-foreground transition-all duration-200"
                  >
                    Continuer sans cache hors-ligne
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
