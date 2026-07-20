import { Button } from '@/components/ui/button';
import { Mail } from 'lucide-react';

interface ResetPasswordFormProps {
    email: string;
    onEmailChange: (v: string) => void;
    error: string;
    loading: boolean;
    turnstileLoading: boolean;
    turnstileError: boolean;
    turnstileErrorMsg: string | null;
    onSubmit: (e: React.FormEvent) => void;
    onBack: () => void;
}

export function ResetPasswordForm({
    email, onEmailChange,
    error, loading, turnstileLoading, turnstileError, turnstileErrorMsg,
    onSubmit, onBack,
}: ResetPasswordFormProps) {
    return (
        <div className="text-center py-4">
            <h3 className="text-lg font-semibold mb-2">Mot de passe oublie</h3>
            <p className="text-sm text-muted-foreground mb-6">
                Saisis ton email pour recevoir un lien de reinitialisation.
            </p>
            <form onSubmit={onSubmit} className="space-y-4">
                <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => onEmailChange(e.target.value)}
                        maxLength={254}
                        className="w-full h-11 bg-secondary/50 border border-border rounded-lg pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                    />
                </div>
                {error && (
                    <p className="text-sm text-red-500 bg-red-500/10 p-2 rounded-lg">{error}</p>
                )}
                {turnstileLoading && (
                    <p className="text-xs text-muted-foreground">Verification anti-bot en cours...</p>
                )}
                {turnstileErrorMsg && (
                    <p className="text-sm text-amber-500 bg-amber-500/10 p-2 rounded-lg">{turnstileErrorMsg}</p>
                )}
                <Button type="submit" className="w-full h-11 font-bold" disabled={loading || turnstileLoading}>
                    {loading ? 'Envoi...' : 'Envoyer le lien'}
                </Button>
            </form>
            <button
                type="button"
                onClick={onBack}
                className="mt-4 text-sm text-primary font-medium hover:underline cursor-pointer"
            >
                Retour a la connexion
            </button>
        </div>
    );
}
