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
      "Clic icone uBlock dans la barre d'outils",
      'Clic bouton power (ON) pour desactiver',
      'La page se recharge',
    ],
  },
  {
    label: 'AdBlock / AdBlock Plus',
    steps: [
      "Clic icone AdBlock dans la barre d'outils",
      '"Ne pas exécuter sur ce site"',
      'Rechargez la page',
    ],
  },
  {
    label: 'Brave / bloqueur integre',
    steps: [
      "Clic bouclier dans la barre d'URL",
      'Desactivez le blocage pour ce site',
      'Rechargez la page',
    ],
  },
];

export default function AdBlockGuard() {
  const [visible, setVisible] = useState(false);

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
        position: 'fixed', inset: 0, zIndex: 99999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,.55)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        fontFamily: "'Satoshi', sans-serif",
      }}
    >
      <div
        style={{
          width: 360, maxWidth: 'calc(100% - 32px)',
          background: '#111218',
          border: '1px solid #1f2233',
          borderRadius: 16,
          boxShadow: '0 12px 48px rgba(0,0,0,.5)',
        }}
      >
        <div style={{ padding: 24 }}>
          <p style={{
            margin: 0, fontSize: 15, fontWeight: 700,
            color: '#f0ede8', lineHeight: 1.4,
          }}>
            Bloqueur de pub detecte
          </p>
          <p style={{
            margin: '8px 0 18px', fontSize: 13,
            color: '#7a7590', lineHeight: 1.5,
          }}>
            WebMedia est gratuit et finance par la pub. Ajoutez ce site a
            votre liste blanche pour nous soutenir.
          </p>

          <button
            onClick={handleWhitelist}
            style={{
              display: 'block', width: '100%',
              padding: '10px 0', borderRadius: 9, border: 'none',
              background: '#3b82f6', color: '#fff',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              marginBottom: 8,
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
            onClick={handleDismiss}
            style={{
              display: 'block', width: '100%',
              padding: '10px 0', borderRadius: 9, border: '1px solid #262833',
              background: 'transparent', color: '#7a7590',
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}
          >
            Plus tard
          </button>
        </div>

        <div style={{
          borderTop: '1px solid #1b1e2e',
          padding: '14px 24px 18px',
        }}>
          <p style={{
            margin: '0 0 10px', fontSize: 10, fontWeight: 600,
            color: '#5a5570', textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            Comment faire
          </p>
          {STEPS.map((ext) => (
            <div key={ext.label} style={{ marginBottom: 10 }}>
              <p style={{
                margin: 0, fontSize: 12, fontWeight: 600,
                color: '#8a859a',
              }}>
                {ext.label}
              </p>
              {ext.steps.map((s, i) => (
                <p key={i} style={{
                  margin: '1px 0', fontSize: 11, color: '#5a5570',
                  lineHeight: 1.5, paddingLeft: 10,
                }}>
                  {i + 1}. {s}
                </p>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
