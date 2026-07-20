import { useState, useEffect } from 'react';
import { authClient, sendVerificationEmail, changePassword, useCachedSession, clearUserCache } from '@/lib/auth-client';
import { EmptyState } from './EmptyState';
import { clearFavorites, clearWatchlist } from '../lib/indexeddb';
import { useTurnstile } from './Turnstile';
import { AccountInfoCard } from './AccountInfoCard';
import { EmailVerificationCard } from './EmailVerificationCard';
import { PasswordChangeForm } from './PasswordChangeForm';
import { OfflineModeCard } from './OfflineModeCard';
import { LocalDataCard } from './LocalDataCard';

async function clearFavs() {
  await clearFavorites();
  window.location.reload();
}

async function clearWl() {
  await clearWatchlist();
  window.location.reload();
}

export function UserSettings() {
  const { data: session, isPending } = useCachedSession();
  const sessionUser = session?.user;

  const [verifSending, setVerifSending] = useState(false);
  const [verifSent, setVerifSent] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSending, setPwSending] = useState(false);
  const [pwDone, setPwDone] = useState(false);
  const [offlineEnabled, setOfflineEnabled] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('webmedia_storage_consent:v1') === 'full'
  );
  const [cacheCleared, setCacheCleared] = useState(false);
  const { getToken: getTurnstileToken } = useTurnstile();
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);

  useEffect(() => {
    if (!sessionUser) return;
    (async () => {
      try {
        const { data: accounts } = await authClient.listAccounts();
        const hasCredential = accounts?.some((a: { providerId: string }) => a.providerId === 'credential') ?? false;
        setHasPassword(hasCredential);
      } catch {
        setHasPassword(false);
      }
    })();
  }, [sessionUser]);

  const currentUser = sessionUser ? {
    id: sessionUser.id,
    email: sessionUser.email,
    username: sessionUser.name,
    avatar: sessionUser.image || undefined,
  } : null;

  if (isPending) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="relative w-10 h-10">
          <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
          <div className="absolute inset-0 rounded-full border-2 border-t-primary animate-spin" />
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <EmptyState title="Non connecte" description="Connecte-toi pour acceder aux reglages." action={{ label: "Retour a l'accueil", href: '/' }} />
      </div>
    );
  }

  const isVerified = sessionUser?.emailVerified ?? true;

  const handleSendVerification = async () => {
    const turnstileToken = await getTurnstileToken();
    if (!turnstileToken) return;
    setVerifSending(true);
    try {
      await sendVerificationEmail({
        email: currentUser.email,
        callbackURL: window.location.origin + '/verify-success',
        fetchOptions: {
          headers: { 'x-captcha-response': turnstileToken },
        },
      });
      setVerifSent(true);
      setTimeout(() => setVerifSent(false), 4000);
    } catch {}
    setVerifSending(false);
  };

  const handlePasswordSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const turnstileToken = await getTurnstileToken();
    if (!turnstileToken) { setPwError('Verification anti-bot echouee, reessaye'); return; }
    const form = e.target as HTMLFormElement;
    const currentPw = (form.elements.namedItem('currentPw') as HTMLInputElement).value;
    const newPw = (form.elements.namedItem('newPw') as HTMLInputElement).value;
    const confirmPw = (form.elements.namedItem('confirmPw') as HTMLInputElement).value;
    if (newPw.length < 8) return setPwError('Minimum 8 caracteres');
    if (newPw.length > 16) return setPwError('Maximum 16 caracteres');
    if (!/[A-Z]/.test(newPw)) return setPwError('Au moins une lettre majuscule requise');
    if (!/[a-z]/.test(newPw)) return setPwError('Au moins une lettre minuscule requise');
    if (!/[0-9]/.test(newPw)) return setPwError('Au moins un chiffre requis');
    if (!/[^A-Za-z0-9]/.test(newPw)) return setPwError('Au moins un caractere special requis (!@#$%^&*)');
    if (newPw !== confirmPw) return setPwError('Les mots de passe ne correspondent pas');
    setPwSending(true);
    setPwError('');
    try {
      const { error: changeErr } = await changePassword({
        currentPassword: currentPw,
        newPassword: newPw,
        fetchOptions: {
          headers: { 'x-captcha-response': turnstileToken },
        },
      });
      if (changeErr) {
        setPwError(changeErr.message || 'Erreur');
      } else {
        setPwDone(true);
        form.reset();
        setTimeout(() => setPwDone(false), 4000);
      }
    } catch (err: any) {
      setPwError(err?.message || 'Erreur');
    }
    setPwSending(false);
  };

  const toggleOffline = () => {
    const enable = !offlineEnabled;
    setOfflineEnabled(enable);
    localStorage.setItem('webmedia_storage_consent:v1', enable ? 'full' : 'minimal');
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SET_OFFLINE', value: enable });
    }
    if (!enable && 'caches' in window) {
      caches.keys().then(function(ks) {
        return Promise.all(ks.map(function(k) { return caches.delete(k); }));
      });
    }
  };

  const clearCache = async () => {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    setCacheCleared(true);
    setTimeout(() => setCacheCleared(false), 3000);
  };

  const handleLogout = () => {
    clearUserCache();
    authClient.signOut();
    window.location.reload();
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-8 pb-16 animate-fade-in-up">
      <AccountInfoCard
        username={currentUser.username}
        email={currentUser.email}
        avatar={currentUser.avatar}
        onLogout={handleLogout}
      />

      <div className="space-y-4">
        <EmailVerificationCard
          email={currentUser.email}
          isVerified={isVerified}
          onSendVerification={handleSendVerification}
          sending={verifSending}
          sent={verifSent}
        />

        {hasPassword === false ? (
          <div className="p-5 rounded-2xl bg-secondary/15 border border-border/40">
            <p className="text-xs text-muted-foreground/70">
              Compte Google -- connexion sans mot de passe.
            </p>
          </div>
        ) : hasPassword === null ? (
          <div className="p-5 rounded-2xl bg-secondary/15 border border-border/40">
            <p className="text-xs text-muted-foreground/50">Chargement...</p>
          </div>
        ) : (
          <PasswordChangeForm
            error={pwError}
            sending={pwSending}
            done={pwDone}
            onSubmit={handlePasswordSubmit}
          />
        )}

        <OfflineModeCard
          enabled={offlineEnabled}
          onToggle={toggleOffline}
          cacheCleared={cacheCleared}
          onClearCache={clearCache}
        />

        <LocalDataCard
          onClearFavorites={clearFavs}
          onClearWatchlist={clearWl}
        />
      </div>

      <p className="text-xs text-muted-foreground/50 text-center mt-8">
        WebMedia v1.0.0
      </p>
    </div>
  );
}
