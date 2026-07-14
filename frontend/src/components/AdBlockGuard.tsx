import { useEffect, useState, useCallback } from 'react';
import {
  detectAdBlocker,
  shouldShowPopup,
  setDismissed,
  setWhitelistPending,
} from '../lib/adblock-detect';

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
    return () => { mounted = false; if (interval) clearInterval(interval); };
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed();
    setVisible(false);
  }, []);

  const handleWhitelist = useCallback(() => {
    setWhitelistPending();
    setVisible(false);
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
          width: 340, maxWidth: 'calc(100% - 32px)',
          background: '#111218',
          border: '1px solid #1f2233',
          borderRadius: 14,
          boxShadow: '0 12px 48px rgba(0,0,0,.5)',
        }}
      >
        <div style={{ padding: 24, paddingBottom: showHelp ? 8 : 24 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#f0ede8' }}>
            Bloqueur de pub detecte
          </p>
          <p style={{ margin: '8px 0 18px', fontSize: 13, color: '#7a7590', lineHeight: 1.5 }}>
            WebMedia est gratuit et finance par la pub. Ajoutez ce site a votre
            liste blanche pour nous soutenir.
          </p>

          <button
            onClick={handleWhitelist}
            style={{
              display: 'block', width: '100%', padding: '10px 0',
              borderRadius: 9, border: 'none',
              background: '#3b82f6', color: '#fff',
              fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: 8,
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#2563eb'}
            onMouseLeave={(e) => e.currentTarget.style.background = '#3b82f6'}
          >
            J'ai whiteliste
          </button>

          <button
            onClick={handleDismiss}
            style={{
              display: 'block', width: '100%', padding: '10px 0',
              borderRadius: 9, border: '1px solid #262833',
              background: 'transparent', color: '#7a7590',
              fontSize: 13, cursor: 'pointer', marginBottom: 4,
            }}
          >
            Plus tard (2 min)
          </button>

          <button
            onClick={() => setShowHelp((s) => !s)}
            style={{
              display: 'block', width: '100%',
              padding: '6px 0', borderRadius: 6, border: 'none',
              background: 'transparent', color: '#5a5570',
              fontSize: 11, cursor: 'pointer',
            }}
          >
            {showHelp ? 'Masquer les instructions' : 'Comment whitelister ?'}
          </button>
        </div>

        {showHelp && (
          <div style={{ borderTop: '1px solid #1b1e2e', padding: '12px 24px 18px' }}>
            <div style={{ marginBottom: 10 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#6a6580' }}>
                uBlock Origin / uBO Lite
              </p>
              <p style={{ margin: '2px 0', fontSize: 11, color: '#5a5570', paddingLeft: 8 }}>
                1. Clic icone uBlock dans la barre d'outils<br />
                2. Clic bouton power pour desactiver<br />
                3. La page se recharge
              </p>
            </div>
            <div style={{ marginBottom: 10 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#6a6580' }}>
                AdBlock / AdBlock Plus
              </p>
              <p style={{ margin: '2px 0', fontSize: 11, color: '#5a5570', paddingLeft: 8 }}>
                1. Clic icone AdBlock dans la barre d'outils<br />
                2. "Ne pas executer sur ce site"<br />
                3. Rechargez la page
              </p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#6a6580' }}>
                Brave / bloqueur integre
              </p>
              <p style={{ margin: '2px 0', fontSize: 11, color: '#5a5570', paddingLeft: 8 }}>
                1. Clic bouclier dans la barre d'URL<br />
                2. Desactivez le blocage<br />
                3. Rechargez la page
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
