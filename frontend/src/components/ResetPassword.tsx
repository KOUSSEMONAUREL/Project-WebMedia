import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { Lock, Eye, EyeOff, CheckCircle } from 'lucide-react';
import { useTurnstile } from './Turnstile';

export function ResetPassword() {
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const token = params.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const { getToken: getTurnstileToken } = useTurnstile();

  if (!token) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-red-500/10 mb-6">
            <svg className="h-10 w-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-3">Lien invalide</h1>
          <p className="text-muted-foreground mb-6">Ce lien de reinitialisation est invalide ou a expire.</p>
          <a href="/" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm text-white" style={{background:'linear-gradient(135deg,#60a5fa,#3b82f6)'}}>Retour a l'accueil</a>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-500/10 mb-6">
            <CheckCircle className="h-10 w-10 text-green-500" />
          </div>
          <h1 className="text-2xl font-bold mb-3">Mot de passe reinitialise</h1>
          <p className="text-muted-foreground mb-6">Tu peux maintenant te connecter avec ton nouveau mot de passe.</p>
          <a href="/" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm text-white" style={{background:'linear-gradient(135deg,#60a5fa,#3b82f6)'}}>Retour a l'accueil</a>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Minimum 8 caracteres');
      return;
    }
    if (password.length > 16) {
      setError('Maximum 16 caracteres');
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setError('Au moins une lettre majuscule requise');
      return;
    }
    if (!/[a-z]/.test(password)) {
      setError('Au moins une lettre minuscule requise');
      return;
    }
    if (!/[0-9]/.test(password)) {
      setError('Au moins un chiffre requis');
      return;
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
      setError('Au moins un caractere special requis (!@#$%^&*)');
      return;
    }
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    const turnstileToken = await getTurnstileToken();
    if (!turnstileToken) { setError('Verification anti-bot echouee, reessaye'); return; }
    setLoading(true);
    try {
      const { error: resetError } = await authClient.resetPassword({
        newPassword: password,
        token,
        fetchOptions: {
          headers: { 'x-captcha-response': turnstileToken },
        },
      });
      if (resetError) {
        setError(resetError.message || 'Erreur');
      } else {
        setDone(true);
      }
    } catch (err: any) {
      setError(err?.message || 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-2 text-center">Nouveau mot de passe</h1>
        <p className="text-sm text-muted-foreground mb-6 text-center">Choisis un nouveau mot de passe pour ton compte.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Nouveau mot de passe"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 bg-secondary/50 border border-border rounded-lg pl-10 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Confirmer"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full h-11 bg-secondary/50 border border-border rounded-lg pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
            />
          </div>
          {error && <p className="text-sm text-red-500 bg-red-500/10 p-2 rounded-lg">{error}</p>}
          <Button type="submit" className="w-full h-11 font-bold" disabled={loading}>
            {loading ? 'Envoi...' : 'Reinitialiser'}
          </Button>
        </form>
      </div>
    </div>
  );
}
