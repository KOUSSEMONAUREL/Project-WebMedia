import { useEffect, useState, useCallback } from 'react';
import {
  detectAdBlocker,
  shouldShowPopup,
  setDismissed,
  clearDetectionCache,
} from '../lib/adblock-detect';

const OVERLAY_STYLE: Record<string, string | number> = {
  position: 'fixed',
  inset: '0',
  zIndex: 99999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(4, 4, 10, 0.7)',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  fontFamily: "'Satoshi', sans-serif",
};

const CARD_STYLE: Record<string, string | number> = {
  maxWidth: 440,
  width: 'calc(100% - 40px)',
  maxHeight: 'calc(100dvh - 40px)',
  overflowY: 'auto',
  background: '#111218',
  border: '1px solid #1f2233',
  borderRadius: 20,
  boxShadow: '0 24px 80px rgba(0,0,0,.6)',
  padding: 40,
  boxSizing: 'border-box',
};

const STEPS = [
  {
    label: 'uBlock Origin / uBO Lite',
    steps: [
      "Cliquez sur l'icone uBlock dans la barre d'outils",
      "Cliquez sur le gros bouton power pour desactiver sur ce site",
      'La page se recharge automatiquement',
    ],
  },
  {
    label: 'AdBlock / AdBlock Plus',
    steps: [
      "Cliquez sur l'icone AdBlock dans la barre d'outils",
      'Choisissez "Ne pas exécuter sur ce site"',
      'Rechargez la page',
    ],
  },
  {
    label: 'Brave / navigateur avec bloqueur integre',
    steps: [
      "Cliquez sur l'icone du bouclier dans la barre d'URL",
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
    <div style={OVERLAY_STYLE}>
      <div style={CARD_STYLE}>
        <div
          style={{
            width: 56, height: 56, borderRadius: 16, margin: '0 auto 20px',
            background: 'linear-gradient(135deg, #3b82f6, #60a5fa)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 700, color: '#fff',
          }}
        >
          +
        </div>

        <h2
          style={{
            margin: 0, fontSize: 20, fontWeight: 700,
            color: '#f0ede8', textAlign: 'center', lineHeight: 1.3,
          }}
        >
          Vous utilisez un bloqueur de pub ?
        </h2>

        <p
          style={{
            margin: '12px 0 28px', fontSize: 14,
            color: '#7a7590', textAlign: 'center', lineHeight: 1.6,
          }}
        >
          WebMedia est entierement gratuit et finance par la publicite.
          Pour nous soutenir et continuer a acceder a tout le contenu,
          merci d'ajouter ce site a la liste blanche de votre bloqueur.
        </p>

        <div style={{ display: 'flex', gap: 10, marginBottom: 28 }}>
          <button
            onClick={handleWhitelist}
            style={{
              flex: 1, padding: '12px 0', borderRadius: 10, border: 'none',
              background: '#3b82f6', color: '#fff',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
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
              padding: '12px 18px', borderRadius: 10, border: '1px solid #262833',
              background: 'transparent', color: '#7a7590',
              fontSize: 14, fontWeight: 500, cursor: 'pointer',
            }}
          >
            Plus tard
          </button>
        </div>

        <div
          style={{
            borderTop: '1px solid #1b1e2e',
            paddingTop: 20,
          }}
        >
          <p
            style={{
              margin: '0 0 14px', fontSize: 11, fontWeight: 600,
              color: '#5a5570', textAlign: 'center',
              textTransform: 'uppercase', letterSpacing: '0.08em',
            }}
          >
            Comment faire selon votre bloqueur
          </p>

          {STEPS.map((ext) => (
            <div key={ext.label} style={{ marginBottom: 14 }}>
              <p
                style={{
                  margin: '0 0 4px', fontSize: 13, fontWeight: 600,
                  color: '#a09bb8',
                }}
              >
                {ext.label}
              </p>
              {ext.steps.map((step, i) => (
                <p
                  key={i}
                  style={{
                    margin: '1px 0', fontSize: 12, color: '#6a6580',
                    lineHeight: 1.5, paddingLeft: 14,
                  }}
                >
                  {i + 1}. {step}
                </p>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
