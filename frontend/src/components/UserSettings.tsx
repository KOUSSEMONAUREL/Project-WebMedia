import { useState, useEffect } from 'react';
import { authClient, sendVerificationEmail, changePassword } from '@/lib/auth-client';
import { LogOut, Trash2, Mail, Lock, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { clearFavorites, clearWatchlist } from '../lib/indexeddb';
import { useTurnstile, verifyTurnstileToken } from './Turnstile';

export function UserSettings() {
  const { data: session, isPending } = authClient.useSession();
  const sessionUser = session?.user;

  const [verifSending, setVerifSending] = useState(false);
  const [verifSent, setVerifSent] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSending, setPwSending] = useState(false);
  const [pwDone, setPwDone] = useState(false);
  const [offlineEnabled, setOfflineEnabled] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('webmedia_storage_consent') === 'full'
  );
  const [cacheCleared, setCacheCleared] = useState(false);
  const { getToken: getTurnstileToken, reset: resetTurnstile } = useTurnstile();
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);

  useEffect(() => {
    if (!sessionUser) return;
    (async () => {
      try {
        const res = await authClient.listAccounts();
        console.log('[UserSettings] listAccounts raw:', JSON.stringify(res, null, 2));
        const accounts = (res as any)?.data ?? res;
        const arr = Array.isArray(accounts) ? accounts : [];
        const hasCredential = arr.some((a: any) => a.providerId === 'credential');
        console.log('[UserSettings] hasCredential:', hasCredential, 'accounts:', arr.length);
        setHasPassword(hasCredential);
      } catch (e) {
        console.error('[UserSettings] listAccounts error:', e);
        setHasPassword(false);
      }
    })();
  }, [sessionUser]);

  const verifyTurnstile = async (): Promise<boolean> => {
    try {
      const token = await getTurnstileToken();
      if (!token) return false;
      const ok = await verifyTurnstileToken(token);
      if (ok) resetTurnstile();
      return ok;
    } catch { return false; }
  };

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
    const turned = await verifyTurnstile();
    if (!turned) return;
    setVerifSending(true);
    try {
      await sendVerificationEmail({
        email: currentUser.email,
        callbackURL: window.location.origin + '/verify-success',
      });
      setVerifSent(true);
      setTimeout(() => setVerifSent(false), 4000);
    } catch {}
    setVerifSending(false);
  };

  const clearFavs = async () => {
    await clearFavorites();
    window.location.reload();
  };

  const clearWl = async () => {
    await clearWatchlist();
    window.location.reload();
  };

  const toggleOffline = async (enable: boolean) => {
    setOfflineEnabled(enable);
    localStorage.setItem('webmedia_storage_consent', enable ? 'full' : 'minimal');
    if (enable) {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      }
    } else {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
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
          onClick={() => { authClient.signOut(); window.location.reload(); }}
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
            const turned = await verifyTurnstile();
            if (!turned) { setPwError('Verification anti-bot echouee, reessaye'); return; }
            const form = e.target as HTMLFormElement;
            const currentPw = (form.elements.namedItem('currentPw') as HTMLInputElement).value;
            const newPw = (form.elements.namedItem('newPw') as HTMLInputElement).value;
            const confirmPw = (form.elements.namedItem('confirmPw') as HTMLInputElement).value;
            if (newPw.length < 6) return setPwError('Minimum 6 caracteres');
            if (newPw !== confirmPw) return setPwError('Les mots de passe ne correspondent pas');
            setPwSending(true);
            setPwError('');
            try {
              const { error: changeErr } = await changePassword({ currentPassword: currentPw, newPassword: newPw });
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
            <button onClick={clearFavs} className="flex-1 h-10 rounded-xl text-sm font-medium bg-secondary/50 border border-border hover:bg-secondary/80 transition-all cursor-pointer">
              Vider les favoris
            </button>
            <button onClick={clearWl} className="flex-1 h-10 rounded-xl text-sm font-medium bg-secondary/50 border border-border hover:bg-secondary/80 transition-all cursor-pointer">
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
