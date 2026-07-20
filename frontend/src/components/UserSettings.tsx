import { useState, useEffect } from 'react';
import { authClient, sendVerificationEmail, changePassword, useCachedSession, clearUserCache } from '@/lib/auth-client';
import { LogOut, Trash2, Mail, Lock, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { clearFavorites, clearWatchlist } from '../lib/indexeddb';
import { useTurnstile } from './Turnstile';

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

  const toggleOffline = (enable: boolean) => {
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

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-8 pb-16 animate-fade-in-up">
      {/* Compte */}
      <div className="flex items-center gap-4 mb-8 p-5 rounded-2xl bg-secondary/15 border border-border/40">
        <div className="h-14 w-14 rounded-full overflow-hidden bg-card border-2 border-primary/30 shrink-0">
          <img
            src={currentUser.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${currentUser.email}`}
            alt=""
            className="h-full w-full object-cover"
          />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-display font-semibold text-foreground truncate">{currentUser.username}</h2>
          <p className="text-sm text-muted-foreground truncate">{currentUser.email}</p>
        </div>
        <button
          type="button"
          onClick={() => { clearUserCache(); authClient.signOut(); window.location.reload(); }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-red-950/20 text-red-400 hover:bg-red-950/40 border border-red-500/20 transition-all cursor-pointer"
        >
          <LogOut className="h-4 w-4" />
          Deconnexion
        </button>
      </div>

      <div className="space-y-4">
        {/* Verification email */}
        <div className="p-5 rounded-2xl bg-secondary/15 border border-border/40">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${isVerified ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
                <Mail className={`h-4 w-4 ${isVerified ? 'text-emerald-400' : 'text-amber-400'}`} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {isVerified ? 'Email verifie' : 'Email non verifie'}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{currentUser.email}</p>
              </div>
            </div>
            {!isVerified && (
              <button
                type="button"
                onClick={handleSendVerification}
                disabled={verifSending}
                className="shrink-0 text-xs font-medium text-amber-300 hover:text-amber-100 transition-colors px-3 py-1.5 rounded-lg border border-amber-500/30 hover:bg-amber-500/10 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`h-3 w-3 ${verifSending ? 'animate-spin' : ''}`} />
                {verifSending ? 'Envoi...' : verifSent ? 'Envoye' : 'Renvoyer'}
              </button>
            )}
          </div>
        </div>

        {/* Changer mot de passe */}
        <div className="p-5 rounded-2xl bg-secondary/15 border border-border/40">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-secondary/50 flex items-center justify-center">
              <Lock className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold text-foreground">Mot de passe</p>
          </div>
          {hasPassword === false ? (
            <p className="text-xs text-muted-foreground/70">
              Compte Google -- connexion sans mot de passe.
            </p>
          ) : hasPassword === null ? (
            <p className="text-xs text-muted-foreground/50">Chargement...</p>
          ) : (
          <form onSubmit={async (e) => {
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
          }} className="space-y-3">
            <input
              type="password"
              name="currentPw"
              placeholder="Mot de passe actuel"
              required
              className="w-full h-10 bg-secondary/50 border border-border rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
            />
            <div className="flex gap-2">
              <input
                type="password"
                name="newPw"
                placeholder="Nouveau mot de passe"
                required
                className="flex-1 h-10 bg-secondary/50 border border-border rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              />
              <input
                type="password"
                name="confirmPw"
                placeholder="Confirmer"
                required
                className="flex-1 h-10 bg-secondary/50 border border-border rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              />
            </div>
            {pwError && <p className="text-xs text-red-400">{pwError}</p>}
            <button
              type="submit"
              disabled={pwSending}
              className="w-full h-10 rounded-xl text-sm font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-all disabled:opacity-50 cursor-pointer"
            >
              {pwSending ? 'Enregistrement...' : pwDone ? 'Modifie' : 'Modifier le mot de passe'}
            </button>
          </form>
          )}
        </div>

        {/* Hors-ligne */}
        <div className="p-5 rounded-2xl bg-secondary/15 border border-border/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-secondary/50 flex items-center justify-center">
                {offlineEnabled
                  ? <Wifi className="h-4 w-4 text-blue-400" />
                  : <WifiOff className="h-4 w-4 text-muted-foreground" />}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Mode hors-ligne</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {offlineEnabled ? 'Cache active' : 'Cache desactive'}
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={offlineEnabled}
              aria-label={offlineEnabled ? 'Desactiver le mode hors-ligne' : 'Activer le mode hors-ligne'}
              onClick={() => toggleOffline(!offlineEnabled)}
              className={`relative w-11 h-6 rounded-full border transition-all duration-300 cursor-pointer ${
                offlineEnabled ? 'bg-blue-600 border-blue-500' : 'bg-secondary border-border'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-300 ${
                offlineEnabled ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
          </div>
          {offlineEnabled && (
            <div className="mt-4 pt-4 border-t border-border/30 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Vider le cache</p>
              <button
                type="button"
                onClick={clearCache}
                className="text-xs font-medium text-muted-foreground hover:text-red-400 px-3 py-1.5 rounded-lg border border-border hover:border-red-500/30 transition-all cursor-pointer"
              >
                {cacheCleared ? 'Cache vide' : 'Vider'}
              </button>
            </div>
          )}
        </div>

        {/* Donnees locales */}
        <div className="p-5 rounded-2xl bg-secondary/15 border border-border/40">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-secondary/50 flex items-center justify-center">
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold text-foreground">Donnees locales</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={clearFavs} className="flex-1 h-10 rounded-xl text-sm font-medium bg-secondary/50 border border-border hover:bg-secondary/80 transition-all cursor-pointer">
              Vider les favoris
            </button>
            <button type="button" onClick={clearWl} className="flex-1 h-10 rounded-xl text-sm font-medium bg-secondary/50 border border-border hover:bg-secondary/80 transition-all cursor-pointer">
              Vider la watchlist
            </button>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground/50 text-center mt-8">
        WebMedia v1.0.0
      </p>
    </div>
  );
}
