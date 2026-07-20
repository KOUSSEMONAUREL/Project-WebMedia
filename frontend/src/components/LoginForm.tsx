import { Button } from '@/components/ui/button';
import { Mail, Lock, Globe, Eye, EyeOff } from 'lucide-react';

interface LoginFormProps {
    email: string;
    onEmailChange: (v: string) => void;
    password: string;
    onPasswordChange: (v: string) => void;
    showPassword: boolean;
    onTogglePassword: () => void;
    error: string;
    loading: boolean;
    turnstileLoading: boolean;
    turnstileErrorMsg: string | null;
    onSubmit: (e: React.FormEvent) => void;
    onGoogleLogin: () => void;
    onForgotPassword: () => void;
    onSwitchToSignup: () => void;
}

export function LoginForm({
    email, onEmailChange,
    password, onPasswordChange,
    showPassword, onTogglePassword,
    error, loading, turnstileLoading, turnstileErrorMsg,
    onSubmit, onGoogleLogin, onForgotPassword, onSwitchToSignup,
}: LoginFormProps) {
    return (
        <>
            <div className="mb-6 p-4 bg-secondary/30 rounded-lg border border-border">
                <p className="text-sm font-medium text-foreground mb-2">Connectez-vous pour :</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                    <li>Sauvegarder vos favoris</li>
                    <li>Telecharger du contenu</li>
                    <li>Suivre vos series preferees</li>
                    <li>Voir vos statistiques</li>
                </ul>
            </div>

            <div className="flex gap-3 mb-6">
                <Button
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={onGoogleLogin}
                    disabled={loading}
                >
                    <Globe className="h-4 w-4" />
                    Google
                </Button>
            </div>

            <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">ou</span>
                </div>
            </div>

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

                <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Mot de passe"
                        value={password}
                        onChange={(e) => onPasswordChange(e.target.value)}
                        className="w-full h-11 bg-secondary/50 border border-border rounded-lg pl-10 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                    />
                    <button
                        type="button"
                        aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                        onClick={onTogglePassword}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                </div>

                {turnstileLoading && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 p-2 rounded-lg">
                        <span className="relative inline-flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
                        </span>
                        Verification anti-bot en cours...
                    </div>
                )}

                {turnstileErrorMsg && (
                    <p className="text-sm text-amber-500 bg-amber-500/10 p-2 rounded-lg">
                        {turnstileErrorMsg}
                    </p>
                )}

                {error && (
                    <p className="text-sm text-red-500 bg-red-500/10 p-2 rounded-lg">{error}</p>
                )}

                <Button type="submit" className="w-full h-11 font-bold" disabled={loading || turnstileLoading}>
                    {loading ? 'Connexion...' : turnstileLoading ? 'Verification...' : 'Se connecter'}
                </Button>

                <p className="text-center">
                    <button
                        type="button"
                        onClick={onForgotPassword}
                        className="text-xs text-muted-foreground hover:text-primary hover:underline cursor-pointer"
                    >
                        Mot de passe oublie ?
                    </button>
                </p>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
                Pas encore de compte ?{' '}
                <button
                    type="button"
                    onClick={onSwitchToSignup}
                    className="text-primary font-medium hover:underline cursor-pointer"
                >
                    S'inscrire
                </button>
            </p>
        </>
    );
}
