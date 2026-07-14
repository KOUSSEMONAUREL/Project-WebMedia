import { useEffect, useState, useCallback } from 'react';
import {
  detectAdBlocker,
  shouldShowPopup,
  setDismissed,
  clearDetectionCache,
} from '../lib/adblock-detect';

const STEPS = [
  {
    label: 'uBlock Origin / uBO Lite',
    steps: [
      "Cliquez sur l'icone uBlock dans la barre d'outils",
      "Cliquez sur le gros bouton power (ON)",
      "La page se recharge, vous avez whitelist",
    ],
  },
  {
    label: 'AdBlock / AdBlock Plus',
    steps: [
      "Cliquez sur l'icone AdBlock dans la barre d'outils",
      'Choisissez "Ne pas执行 sur ce site"',
      "La page se recharge automatiquement",
    ],
  },
  {
    label: 'Brave / autres bloqueurs',
    steps: [
      "Cliquez sur l'icone du bouclier dans la barre d'URL",
      'Desactivez le blocage pour ce site',
      'Rechargez la page',
    ],
  },
];

export default function AdBlockGuard() {
  const [visible, setVisible] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;

    let mounted = true;
    let interval: ReturnType<typeof setInterval>;

    const run = async () => {
      if (!mounted) return;
      await detectAdBlocker();
      tick();
      interval = setInterval(tick, 120_000);
    };

    const tick = () => {
      if (!mounted) return;
      if (shouldShowPopup()) setVisible(true);
    };

    run();

    return () => {
      mounted = false;
      if (interval) clearInterval(interval);
    };
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed();
    setVisible(false);
  }, []);

  const handleWhitelist = useCallback(() => {
    clearDetectionCache();
    window.location.reload();
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 99999,
        maxWidth: 400,
        width: 'calc(100% - 32px)',
        background: '#13141a',
        border: '1px solid #262833',
        borderRadius: 14,
        boxShadow: '0 8px 32px rgba(0,0,0,.45)',
        fontFamily: "'Satoshi', sans-serif",
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div
            style={{
              width: 40, height: 40, borderRadius: 12, flexShrink: 0,
              background: 'linear-gradient(135deg, #3b82f6, #60a5fa)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 700, color: '#fff', marginTop: 1,
            }}
          >
            +
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                margin: 0, fontSize: 14, fontWeight: 700,
                color: '#f0ede8', lineHeight: 1.4,
              }}
            >
              WebMedia a besoin de vous
            </p>
            <p
              style={{
                margin: '6px 0 16px', fontSize: 13,
                color: '#7a7590', lineHeight: 1.5,
              }}
            >
              Notre site est gratuit et finance par la publicite. Ajoutez ce
              site a la liste blanche de votre bloqueur de pub pour nous
              soutenir et continuer a profiter de tout le contenu.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={handleWhitelist}
                style={{
                  padding: '9px 20px', borderRadius: 9, border: 'none',
                  background: '#3b82f6', color: '#fff',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  transition: 'background .15s',
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = '#2563eb')
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = '#3b82f6')
                }
              >
                J'ai whiteliste
              </button>
              <button
                onClick={() => setShowHelp((s) => !s)}
                style={{
                  padding: '9px 20px', borderRadius: 9, border: '1px solid #262833',
                  background: 'transparent', color: '#a09bb8',
                  fontSize: 13, fontWeight: 500, cursor: 'pointer',
                }}
              >
                {showHelp ? 'Masquer' : 'Comment faire ?'}
              </button>
              <button
                onClick={handleDismiss}
                style={{
                  padding: '9px 16px', borderRadius: 9, border: 'none',
                  background: 'transparent', color: '#5a5570',
                  fontSize: 13, cursor: 'pointer',
                }}
              >
                Plus tard
              </button>
            </div>
          </div>
        </div>
      </div>

      {showHelp && (
        <div
          style={{
            borderTop: '1px solid #1e2030',
            padding: '0 20px 16px',
          }}
        >
          {STEPS.map((ext) => (
            <div key={ext.label} style={{ marginTop: 14 }}>
              <p
                style={{
                  margin: '0 0 6px', fontSize: 12, fontWeight: 600,
                  color: '#7a7590', textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {ext.label}
              </p>
              {ext.steps.map((step, i) => (
                <p
                  key={i}
                  style={{
                    margin: '2px 0', fontSize: 12, color: '#9a95b0',
                    lineHeight: 1.5, paddingLeft: 12,
                  }}
                >
                  {i + 1}. {step}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
