import { useState, useEffect } from 'react';
import { sendVerificationEmail, useCachedSession } from '@/lib/auth-client';
import { authStore } from '@/stores/auth';
import { X, Mail, RefreshCw } from 'lucide-react';
import { useTurnstile } from './Turnstile';

const DISMISS_KEY = 'webmedia_verification_dismissed';

export function VerificationBanner() {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = sessionStorage.getItem(DISMISS_KEY);
    if (stored) {
      const ts = parseInt(stored, 10);
      if (Date.now() - ts < 86400000) return true;
    }
    return false;
  });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const { data: session, isPending } = useCachedSession();
  const user = session?.user;
  const { getToken: getTurnstileToken } = useTurnstile();

  const emailVerified = user?.emailVerified ?? true;

  if (isPending || emailVerified || dismissed || !user) return null;

  const handleResend = async () => {
    const turnstileToken = await getTurnstileToken();
    if (!turnstileToken) return;
    setSending(true);
    try {
      await sendVerificationEmail({
        email: user.email,
        callbackURL: window.location.origin + '/verify-success',
        fetchOptions: {
          headers: { 'x-captcha-response': turnstileToken },
        },
      });
      setSent(true);
      setTimeout(() => setSent(false), 4000);
    } catch {}
    setSending(false);
  };

  return (
    <div className="bg-gradient-to-r from-blue-600/20 via-blue-500/10 to-blue-600/20 border-b border-blue-500/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Mail className="h-4 w-4 text-blue-400 shrink-0" />
          <p className="text-sm text-blue-200 truncate">
            Verifie ton email pour acceder aux options de securite.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleResend}
            disabled={sending}
            className="text-xs font-medium text-blue-300 hover:text-blue-100 transition-colors px-3 py-1.5 rounded-lg border border-blue-500/30 hover:bg-blue-500/10 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`h-3 w-3 ${sending ? 'animate-spin' : ''}`} />
            {sending ? 'Envoi...' : sent ? 'Envoye !' : 'Renvoyer'}
          </button>
          <button
            onClick={() => {
              sessionStorage.setItem(DISMISS_KEY, String(Date.now()));
              setDismissed(true);
            }}
            className="text-blue-400/60 hover:text-blue-300 transition-colors p-1 cursor-pointer"
            title="Rappeler plus tard"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
