import { Mail, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SignupSuccessViewProps {
  email: string;
  resending: boolean;
  onResend: () => void;
  onBackToLogin: () => void;
}

export function SignupSuccessView({ email, resending, onResend, onBackToLogin }: SignupSuccessViewProps) {
  return (
    <div className="text-center py-4">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
        <Mail className="h-8 w-8 text-primary" />
      </div>
      <h3 className="text-lg font-semibold mb-2">Verifie ta boite email</h3>
      <p className="text-sm text-muted-foreground mb-1">
        Un email de confirmation a ete envoye a :
      </p>
      <p className="text-sm font-medium text-foreground mb-4">{email}</p>
      <p className="text-xs text-muted-foreground mb-2">
        Clique sur le lien dans l'email pour activer ton compte.
      </p>
      <p className="text-xs text-primary/80 mb-6">
        Tu peux deja te connecter sans attendre.
      </p>
      <Button variant="outline" size="sm" onClick={onResend} disabled={resending} className="gap-2 mb-3">
        <RefreshCw className={`h-3.5 w-3.5 ${resending ? 'animate-spin' : ''}`} />
        {resending ? 'Envoi...' : 'Renvoyer'}
      </Button>
      <div>
        <button type="button" onClick={onBackToLogin} className="text-sm text-primary font-medium hover:underline cursor-pointer">
          Retour a la connexion
        </button>
      </div>
    </div>
  );
}

interface ResetSentViewProps {
  email: string;
  onBackToLogin: () => void;
}

export function ResetSentView({ email, onBackToLogin }: ResetSentViewProps) {
  return (
    <div className="text-center py-4">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
        <Mail className="h-8 w-8 text-primary" />
      </div>
      <h3 className="text-lg font-semibold mb-2">Email envoye</h3>
      <p className="text-sm text-muted-foreground mb-1">
        Un lien de reinitialisation a ete envoye a :
      </p>
      <p className="text-sm font-medium text-foreground mb-4">{email}</p>
      <p className="text-xs text-muted-foreground mb-6">
        Clique sur le lien dans l'email pour choisir un nouveau mot de passe.
      </p>
      <div>
        <button type="button" onClick={onBackToLogin} className="text-sm text-primary font-medium hover:underline cursor-pointer">
          Retour a la connexion
        </button>
      </div>
    </div>
  );
}
