import { Mail, RefreshCw } from 'lucide-react';

interface Props {
  email: string;
  isVerified: boolean;
  onSendVerification: () => void;
  sending: boolean;
  sent: boolean;
}

export function EmailVerificationCard({ email, isVerified, onSendVerification, sending, sent }: Props) {
  return (
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
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{email}</p>
          </div>
        </div>
        {!isVerified && (
          <button
            type="button"
            onClick={onSendVerification}
            disabled={sending}
            className="shrink-0 text-xs font-medium text-amber-300 hover:text-amber-100 transition-colors px-3 py-1.5 rounded-lg border border-amber-500/30 hover:bg-amber-500/10 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`h-3 w-3 ${sending ? 'animate-spin' : ''}`} />
            {sending ? 'Envoi...' : sent ? 'Envoye' : 'Renvoyer'}
          </button>
        )}
      </div>
    </div>
  );
}
