import { Button } from '@/components/ui/button';
import { Mail, Lock, User as UserIcon, Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react';

interface PasswordRules {
    minMax: boolean;
    upper: boolean;
    lower: boolean;
    digit: boolean;
    special: boolean;
    match: boolean;
}

interface RegisterFormProps {
    name: string;
    onNameChange: (v: string) => void;
    email: string;
    onEmailChange: (v: string) => void;
    password: string;
    onPasswordChange: (v: string) => void;
    confirmPassword: string;
    onConfirmPasswordChange: (v: string) => void;
    showPassword: boolean;
    onTogglePassword: () => void;
    error: string;
    loading: boolean;
    turnstileLoading: boolean;
    turnstileErrorMsg: string | null;
    passwordRules: PasswordRules;
    isSignupFormValid: boolean;
    onSubmit: (e: React.FormEvent) => void;
    onSwitchToLogin: () => void;
}

export function RegisterForm({
    name, onNameChange,
    email, onEmailChange,
    password, onPasswordChange,
    confirmPassword, onConfirmPasswordChange,
    showPassword, onTogglePassword,
    error, loading, turnstileLoading, turnstileErrorMsg,
    passwordRules, isSignupFormValid,
    onSubmit, onSwitchToLogin,
}: RegisterFormProps) {
    return (
        <>
            <form onSubmit={onSubmit} className="space-y-4">
                <div className="relative">
                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Nom d'utilisateur"
                        value={name}
                        onChange={(e) => onNameChange(e.target.value)}
                        maxLength={12}
                        className="w-full h-11 bg-secondary/50 border border-border rounded-lg pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                    />
                </div>

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

                <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Confirmer le mot de passe"
                        value={confirmPassword}
                        onChange={(e) => onConfirmPasswordChange(e.target.value)}
                        className="w-full h-11 bg-secondary/50 border border-border rounded-lg pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                    />
                </div>

                {password.length > 0 && (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                        <div className={`flex items-center gap-2 ${passwordRules.minMax ? 'text-green-500' : 'text-muted-foreground'}`}>
                            {passwordRules.minMax ? <CheckCircle className="h-3.5 w-3.5 flex-shrink-0" /> : <XCircle className="h-3.5 w-3.5 flex-shrink-0" />}
                            <span>8 a 16 caracteres</span>
                        </div>
                        <div className={`flex items-center gap-2 ${passwordRules.upper ? 'text-green-500' : 'text-muted-foreground'}`}>
                            {passwordRules.upper ? <CheckCircle className="h-3.5 w-3.5 flex-shrink-0" /> : <XCircle className="h-3.5 w-3.5 flex-shrink-0" />}
                            <span>1 lettre majuscule</span>
                        </div>
                        <div className={`flex items-center gap-2 ${passwordRules.lower ? 'text-green-500' : 'text-muted-foreground'}`}>
                            {passwordRules.lower ? <CheckCircle className="h-3.5 w-3.5 flex-shrink-0" /> : <XCircle className="h-3.5 w-3.5 flex-shrink-0" />}
                            <span>1 lettre minuscule</span>
                        </div>
                        <div className={`flex items-center gap-2 ${passwordRules.digit ? 'text-green-500' : 'text-muted-foreground'}`}>
                            {passwordRules.digit ? <CheckCircle className="h-3.5 w-3.5 flex-shrink-0" /> : <XCircle className="h-3.5 w-3.5 flex-shrink-0" />}
                            <span>1 chiffre</span>
                        </div>
                        <div className={`flex items-center gap-2 ${passwordRules.special ? 'text-green-500' : 'text-muted-foreground'}`}>
                            {passwordRules.special ? <CheckCircle className="h-3.5 w-3.5 flex-shrink-0" /> : <XCircle className="h-3.5 w-3.5 flex-shrink-0" />}
                            <span>1 caractere special (!@#$%^&*)</span>
                        </div>
                        {confirmPassword.length > 0 && (
                            <div className={`flex items-center gap-2 ${passwordRules.match ? 'text-green-500' : 'text-red-500'}`}>
                                {passwordRules.match ? <CheckCircle className="h-3.5 w-3.5 flex-shrink-0" /> : <XCircle className="h-3.5 w-3.5 flex-shrink-0" />}
                                <span>Les mots de passe correspondent</span>
                            </div>
                        )}
                    </div>
                )}

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

                <Button type="submit" className="w-full h-11 font-bold" disabled={loading || turnstileLoading || !isSignupFormValid}>
                    {loading ? 'Inscription...' : turnstileLoading ? 'Verification...' : "S'inscrire"}
                </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
                Deja un compte ?{' '}
                <button
                    type="button"
                    onClick={onSwitchToLogin}
                    className="text-primary font-medium hover:underline cursor-pointer"
                >
                    Se connecter
                </button>
            </p>
        </>
    );
}
