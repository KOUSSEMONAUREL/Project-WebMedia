import { useEffect, useState, useCallback } from 'react';
import { detectAdBlocker, clearDetectionCache } from '../lib/adblock-detect';

export default function AdBlockGuard() {
  const [detected, setDetected] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!import.meta.env.PROD) {
      setChecking(false);
      return;
    }
    let mounted = true;
    detectAdBlocker().then((blocked) => {
      if (!mounted) return;
      setDetected(blocked);
      setChecking(false);
    });
    return () => { mounted = false; };
  }, []);

  const handleReload = useCallback(() => {
    clearDetectionCache();
    window.location.reload();
  }, []);

  if (!import.meta.env.PROD || checking || !detected) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: '#09090c',
      fontFamily: "'Satoshi', sans-serif",
    }}>
      <div style={{
        maxWidth: 500, width: '90%', padding: 40,
        textAlign: 'center' as const,
      }}>
        <div style={{
          width: 64, height: 64, margin: '0 auto 24px',
          borderRadius: 16,
          background: 'linear-gradient(135deg, #3b82f6, #60a5fa)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, color: '#fff',
        }}>
          !
        </div>

        <h1 style={{
          fontSize: 22, fontWeight: 700, color: '#f0ede8',
          marginBottom: 12, lineHeight: 1.3,
        }}>
          Bloqueur de publicite detecte
        </h1>

        <p style={{
          fontSize: 14, color: '#7a7590', lineHeight: 1.6,
          marginBottom: 32,
        }}>
          WebMedia est gratuit et financé par la publicite. Pour continuer a
          profiter du site, merci de desactiver votre bloqueur de publicite
          pour ce site, puis cliquez sur le bouton ci-dessous.
        </p>

        <button
          onClick={handleReload}
          style={{
            padding: '12px 32px', borderRadius: 10, border: 'none',
            background: '#3b82f6', color: '#fff',
            fontSize: 15, fontWeight: 600, cursor: 'pointer',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = '#2563eb'}
          onMouseLeave={(e) => e.currentTarget.style.background = '#3b82f6'}
        >
          J'ai desactive mon Adblock
        </button>

        <p style={{
          fontSize: 12, color: '#4a4560', marginTop: 24, lineHeight: 1.5,
        }}>
          Vous utilisez un bloqueur de publicite ? Ajoutez{' '}
          <strong style={{ color: '#7a7590' }}>project-web-media.vercel.app</strong>
          {' '}a votre liste blanche.
        </p>
      </div>
    </div>
  );
}
