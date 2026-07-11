import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { X, Mail, Lock, User as UserIcon, Eye, EyeOff, Globe, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { authClient, sendVerificationEmail } from '@/lib/auth-client';
import { authStore } from '@/stores/auth';
import { useTurnstile } from './Turnstile';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    onLogin: (user: { name: string; email: string; avatar?: string }) => void;
}

type ViewState = 'form' | 'signup-success' | 'forgot-password' | 'reset-sent';

export function AuthModal({ isOpen, onClose, onLogin }: AuthModalProps) {
    const [mode, setMode] = useState<'login' | 'signup'>('login');
    const [showPassword, setShowPassword] = useState(false);
    const [view, setView] = useState<ViewState>('form');
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        confirmPassword: ''
    });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [resending, setResending] = useState(false);
    const { getToken: getTurnstileToken } = useTurnstile();

    const passwordRules = useMemo(() => ({
        minMax: formData.password.length >= 8 && formData.password.length <= 16,
        upper: /[A-Z]/.test(formData.password),
        lower: /[a-z]/.test(formData.password),
        digit: /[0-9]/.test(formData.password),
        special: /[^A-Za-z0-9]/.test(formData.password),
        match: formData.confirmPassword === '' || formData.password === formData.confirmPassword,
    }), [formData.password, formData.confirmPassword]);

    const isSignupFormValid = mode !== 'signup' || (
        formData.name.trim().length > 0 &&
        formData.email.includes('@') &&
        passwordRules.minMax &&
        passwordRules.upper &&
        passwordRules.lower &&
        passwordRules.digit &&
        passwordRules.special &&
        passwordRules.match &&
        formData.confirmPassword.length > 0
    );

    if (!isOpen) return null;

    const resetForm = () => {
        setFormData({ name: '', email: '', password: '', confirmPassword: '' });
        setError('');
        setView('form');
    };

    const handleResendVerification = async () => {
        const turnstileToken = await getTurnstileToken();
        if (!turnstileToken) {
            setError("Verification anti-bot echouee, reessaye");
            return;
        }
        setResending(true);
        setError('');
        try {
            const { error: resendError } = await sendVerificationEmail({
                email: formData.email,
                callbackURL: window.location.origin + '/verify-success',
                fetchOptions: {
                    headers: { 'x-captcha-response': turnstileToken },
                },
            });
            if (resendError) {
                setError(resendError.message || 'Erreur lors de l\'envoi');
            }
        } catch (err: any) {
            setError(err?.message || 'Erreur lors de l\'envoi');
        } finally {
            setResending(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        const turnstileToken = await getTurnstileToken();
        if (!turnstileToken) {
            setError("Verification anti-bot echouee, reessaye");
            return;
        }

        if (mode === 'login') {
            if (formData.password.length > 16) {
                setError('Mot de passe trop long (max 16 caracteres)');
                return;
            }
        }

        if (mode === 'signup') {
            if (!formData.name.trim()) {
                setError('Veuillez entrer votre nom');
                return;
            }
            if (formData.password !== formData.confirmPassword) {
                setError('Les mots de passe ne correspondent pas');
                return;
            }
            if (formData.password.length < 8) {
                setError('Minimum 8 caracteres');
                return;
            }
            if (formData.password.length > 16) {
                setError('Maximum 16 caracteres');
                return;
            }
            if (!/[A-Z]/.test(formData.password)) {
                setError('Au moins une lettre majuscule requise');
                return;
            }
            if (!/[a-z]/.test(formData.password)) {
                setError('Au moins une lettre minuscule requise');
                return;
            }
            if (!/[0-9]/.test(formData.password)) {
                setError('Au moins un chiffre requis');
                return;
            }
            if (!/[^A-Za-z0-9]/.test(formData.password)) {
                setError('Au moins un caractere special requis (!@#$%^&*)');
                return;
            }
        }

        if (!formData.email.includes('@')) {
            setError('Veuillez entrer un email valide');
            return;
        }

        setLoading(true);

        try {
            if (mode === 'login') {
                const { data, error: signInError } = await authClient.signIn.email({
                    email: formData.email,
                    password: formData.password,
                    fetchOptions: {
                        headers: { 'x-captcha-response': turnstileToken },
                    },
                });

                if (signInError) {
                    setError(signInError.message || 'Erreur de connexion');
                    return;
                }

                if (data?.user) {
                    const userData = {
                        name: data.user.name,
                        email: data.user.email,
                        avatar: data.user.image || undefined,
                    };
                    const authUser = {
                        id: data.user.id,
                        email: data.user.email,
                        username: data.user.name,
                        avatar: data.user.image || undefined,
                        emailVerified: data.user.emailVerified,
                    };
                    authStore.setSession(authUser);
                    onLogin(userData);
                    onClose();
                }
            } else {
                const { error: signUpError } = await authClient.signUp.email({
                    email: formData.email,
                    password: formData.password,
                    name: formData.name,
                    callbackURL: window.location.origin + '/verify-success',
                    fetchOptions: {
                        headers: { 'x-captcha-response': turnstileToken },
                    },
                });

                if (signUpError) {
                    setError(signUpError.message || "Erreur d'inscription");
                    return;
                }

                setView('signup-success');
            }
        } catch (err: any) {
            setError(err?.message || 'Une erreur est survenue');
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        setLoading(true);
        try {
            await authClient.signIn.social({
                provider: 'google',
                callbackURL: window.location.href,
            });
        } catch (err: any) {
            setError(err?.message || 'Erreur lors de la connexion Google');
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
            />

            <div className="relative w-full max-w-md mx-4 bg-card border border-border/70 rounded-2xl shadow-2xl overflow-hidden" style={{boxShadow:'0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)'}}>
                <div
                    className="relative h-20 flex items-center justify-center"
                    style={{
                        background: 'linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(59,130,246,0.06) 100%)',
                        borderBottom: '1px solid rgba(59,130,246,0.15)',
                    }}
                >
                    <h2 className="text-xl font-display font-bold tracking-tight" style={{
                        background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                    }}>
                        {view === 'signup-success'
                            ? 'Verification envoyee'
                            : mode === 'login' ? 'Connexion' : 'Inscription'}
                    </h2>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
                        onClick={onClose}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                <div className="p-6">
                    {view === 'signup-success' ? (
                        <div className="text-center py-4">
                            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                                <Mail className="h-8 w-8 text-primary" />
                            </div>
                            <h3 className="text-lg font-semibold mb-2">Verifie ta boite email</h3>
                            <p className="text-sm text-muted-foreground mb-1">
                                Un email de confirmation a ete envoye a :
                            </p>
                            <p className="text-sm font-medium text-foreground mb-4">{formData.email}</p>
                            <p className="text-xs text-muted-foreground mb-2">
                                Clique sur le lien dans l'email pour activer ton compte.
                            </p>
                            <p className="text-xs text-primary/80 mb-6">
                                Tu peux deja te connecter sans attendre.
                            </p>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleResendVerification}
                                disabled={resending}
                                className="gap-2 mb-3"
                            >
                                <RefreshCw className={`h-3.5 w-3.5 ${resending ? 'animate-spin' : ''}`} />
                                {resending ? 'Envoi...' : 'Renvoyer'}
                            </Button>
                            <div>
                                <button
                                    onClick={() => { setMode('login'); resetForm(); }}
                                    className="text-sm text-primary font-medium hover:underline cursor-pointer"
                                >
                                    Retour a la connexion
                                </button>
                            </div>
                        </div>
                    ) : view === 'reset-sent' ? (
                        <div className="text-center py-4">
                            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                                <Mail className="h-8 w-8 text-primary" />
                            </div>
                            <h3 className="text-lg font-semibold mb-2">Email envoye</h3>
                            <p className="text-sm text-muted-foreground mb-1">
                                Un lien de reinitialisation a ete envoye a :
                            </p>
                            <p className="text-sm font-medium text-foreground mb-4">{formData.email}</p>
                            <p className="text-xs text-muted-foreground mb-6">
                                Clique sur le lien dans l'email pour choisir un nouveau mot de passe.
                            </p>
                            <div>
                                <button
                                    onClick={() => { setView('form'); setError(''); }}
                                    className="text-sm text-primary font-medium hover:underline cursor-pointer"
                                >
                                    Retour a la connexion
                                </button>
                            </div>
                        </div>
                    ) : view === 'forgot-password' ? (
                        <div className="text-center py-4">
                            <h3 className="text-lg font-semibold mb-2">Mot de passe oublie</h3>
                            <p className="text-sm text-muted-foreground mb-6">
                                Saisis ton email pour recevoir un lien de reinitialisation.
                            </p>
                            <form onSubmit={async (e) => {
                                e.preventDefault();
                                setError('');
                                if (!formData.email.includes('@')) {
                                    setError('Email invalide');
                                    return;
                                }
                                const turnstileToken = await getTurnstileToken();
                                if (!turnstileToken) {
                                    setError("Verification anti-bot echouee, reessaye");
                                    return;
                                }
                                setLoading(true);
                                try {
                                    const { error: resetError } = await authClient.requestPasswordReset({
                                        email: formData.email,
                                        redirectTo: window.location.origin + '/reset-password',
                                        fetchOptions: {
                                            headers: { 'x-captcha-response': turnstileToken },
                                        },
                                    });
                                    if (resetError) {
                                        setError(resetError.message || 'Erreur');
                                    } else {
                                        setView('reset-sent');
                                    }
                                } catch (err: any) {
                                    setError(err?.message || 'Erreur');
                                } finally {
                                    setLoading(false);
                                }
                            }} className="space-y-4">
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <input
                                        type="email"
                                        placeholder="Email"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        maxLength={254}
                                        className="w-full h-11 bg-secondary/50 border border-border rounded-lg pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                                    />
                                </div>
                                {error && (
                                    <p className="text-sm text-red-500 bg-red-500/10 p-2 rounded-lg">{error}</p>
                                )}
                                <Button type="submit" className="w-full h-11 font-bold" disabled={loading}>
                                    {loading ? 'Envoi...' : 'Envoyer le lien'}
                                </Button>
                            </form>
                            <button
                                onClick={() => { setView('form'); setError(''); }}
                                className="mt-4 text-sm text-primary font-medium hover:underline cursor-pointer"
                            >
                                Retour a la connexion
                            </button>
                        </div>
                    ) : (
                        <>
                    {mode === 'login' && (
                        <div className="mb-6 p-4 bg-secondary/30 rounded-lg border border-border">
                        <p className="text-sm font-medium text-foreground mb-2">Connectez-vous pour :</p>
                        <ul className="text-xs text-muted-foreground space-y-1">
                            <li>Sauvegarder vos favoris</li>
                            <li>Telecharger du contenu</li>
                            <li>Suivre vos series preferees</li>
                            <li>Voir vos statistiques</li>
                        </ul>
                        </div>
                    )}

                    <div className="flex gap-3 mb-6">
                        <Button
                            variant="outline"
                            className="flex-1 gap-2"
                            onClick={handleGoogleLogin}
                            disabled={loading}
                        >
                            <Globe className="h-4 w-4" />
                            Google
                        </Button>
                    </div>

                    <div className="relative mb-6">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-border"></div>
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-card px-2 text-muted-foreground">ou</span>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {mode === 'signup' && (
                            <div className="relative">
                                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder="Nom d'utilisateur"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    maxLength={12}
                                    className="w-full h-11 bg-secondary/50 border border-border rounded-lg pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                                />
                            </div>
                        )}

                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <input
                                        type="email"
                                        placeholder="Email"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        maxLength={254}
                                        className="w-full h-11 bg-secondary/50 border border-border rounded-lg pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                                    />
                                </div>

                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <input
                                type={showPassword ? 'text' : 'password'}
                                placeholder="Mot de passe"
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                className="w-full h-11 bg-secondary/50 border border-border rounded-lg pl-10 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </div>

                        {mode === 'signup' && (
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    placeholder="Confirmer le mot de passe"
                                    value={formData.confirmPassword}
                                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                    className="w-full h-11 bg-secondary/50 border border-border rounded-lg pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                                />
                            </div>
                        )}

                        {mode === 'signup' && formData.password.length > 0 && (
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
                                {formData.confirmPassword.length > 0 && (
                                    <div className={`flex items-center gap-2 ${passwordRules.match ? 'text-green-500' : 'text-red-500'}`}>
                                        {passwordRules.match ? <CheckCircle className="h-3.5 w-3.5 flex-shrink-0" /> : <XCircle className="h-3.5 w-3.5 flex-shrink-0" />}
                                        <span>Les mots de passe correspondent</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {error && (
                            <p className="text-sm text-red-500 bg-red-500/10 p-2 rounded-lg">{error}</p>
                        )}

                        <Button type="submit" className="w-full h-11 font-bold" disabled={loading || (mode === 'signup' && !isSignupFormValid)}>
                            {loading ? 'Chargement...' : (mode === 'login' ? 'Se connecter' : "S'inscrire")}
                        </Button>

                        {mode === 'login' && (
                            <p className="text-center">
                                <button
                                    type="button"
                                    onClick={() => setView('forgot-password')}
                                    className="text-xs text-muted-foreground hover:text-primary hover:underline cursor-pointer"
                                >
                                    Mot de passe oublie ?
                                </button>
                            </p>
                        )}
                    </form>

                    <p className="mt-6 text-center text-sm text-muted-foreground">
                        {mode === 'login' ? (
                            <>
                                Pas encore de compte ?{' '}
                                <button
                                    onClick={() => { setMode('signup'); setError(''); }}
                                    className="text-primary font-medium hover:underline cursor-pointer"
                                >
                                    S'inscrire
                                </button>
                            </>
                        ) : (
                            <>
                                Deja un compte ?{' '}
                                <button
                                    onClick={() => { setMode('login'); setError(''); }}
                                    className="text-primary font-medium hover:underline cursor-pointer"
                                >
                                    Se connecter
                                </button>
                            </>
                        )}
                    </p>
                    </>
                    )}
                </div>
            </div>
        </div>
    );
}
