import { useEffect, useState, useCallback } from 'react';
import {
  detectAdBlocker,
  shouldShowPopup,
  setDismissed,
  clearDetectionCache,
} from '../lib/adblock-detect';

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
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 99999,
        maxWidth: 380,
        width: 'calc(100% - 32px)',
        background: '#13141a',
        border: '1px solid #262833',
        borderRadius: 12,
        padding: '20px 24px',
        boxShadow: '0 8px 32px rgba(0,0,0,.45)',
        fontFamily: "'Satoshi', sans-serif",
        boxSizing: 'border-box',
      }}
    >
      <button
        onClick={handleDismiss}
        aria-label="Fermer"
        style={{
          position: 'absolute', top: 10, right: 12,
          background: 'none', border: 'none',
          color: '#7a7590', cursor: 'pointer',
          fontSize: 18, lineHeight: 1, padding: 4,
        }}
      >
        x
      </button>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div
          style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: 'linear-gradient(135deg, #3b82f6, #60a5fa)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, color: '#fff', marginTop: 2,
          }}
        >
          i
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              margin: 0, fontSize: 13, fontWeight: 600,
              color: '#f0ede8', lineHeight: 1.4,
            }}
          >
            Vous utilisez un bloqueur de publicite ?
          </p>
          <p
            style={{
              margin: '6px 0 14px', fontSize: 12,
              color: '#7a7590', lineHeight: 1.5,
            }}
          >
            WebMedia est gratuit et finance par les pubs. Ajoutez ce site a
            votre liste blanche pour nous soutenir.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleWhitelist}
              style={{
                padding: '8px 18px', borderRadius: 8, border: 'none',
                background: '#3b82f6', color: '#fff',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = '#2563eb')
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = '#3b82f6')
              }
            >
              J'ai whitelist
            </button>
            <button
              onClick={handleDismiss}
              style={{
                padding: '8px 18px', borderRadius: 8, border: '1px solid #262833',
                background: 'transparent', color: '#7a7590',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Plus tard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
