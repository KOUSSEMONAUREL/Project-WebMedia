import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { authClient, sendVerificationEmail } from '@/lib/auth-client';
import { authStore } from '@/stores/auth';
import { useTurnstile } from './Turnstile';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';
import { ResetPasswordForm } from './ResetPasswordForm';
import { SignupSuccessView, ResetSentView } from './AuthSuccessViews';

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
    const { getToken: getTurnstileToken, loading: turnstileLoading, error: turnstileError, errorMessage: turnstileErrorMsg } = useTurnstile();

    const passwordRules = useMemo(() => ({
        minMax: formData.password.length >= 8 && formData.password.length <= 16,
        upper: /[A-Z]/.test(formData.password),
        lower: /[a-z]/.test(formData.password),
        digit: /[0-9]/.test(formData.password),
        special: /[^A-Za-z0-9]/.test(formData.password),
        match: formData.confirmPassword === '' || formData.password === formData.confirmPassword,
    }), [formData.password, formData.confirmPassword]);

    const isSignupFormValid = (
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
        if (turnstileError) {
            setError(turnstileErrorMsg || 'Erreur anti-bot, recharge la page');
            return;
        }
        const turnstileToken = await getTurnstileToken();
        if (!turnstileToken) {
            setError("Verification anti-bot indisponible. Verifie ton bloqueur de pubs ou reseau.");
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

        if (!formData.email.includes('@')) {
            setError('Veuillez entrer un email valide');
            return;
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
        setError('');
        try {
            await authClient.signIn.social({
                provider: 'google',
                callbackURL: window.location.href,
            });
        } catch (err: any) {
            setError(err?.message || 'Erreur lors de la connexion Google');
        } finally {
            setLoading(false);
        }
    };

    const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!formData.email.includes('@')) {
            setError('Email invalide');
            return;
        }
        if (turnstileError) {
            setError(turnstileErrorMsg || 'Erreur anti-bot, recharge la page');
            return;
        }
        if (turnstileLoading) {
            setError('Verification anti-bot en cours, patiente...');
            return;
        }
        const turnstileToken = await getTurnstileToken();
        if (!turnstileToken) {
            setError('Verification anti-bot echouee. Verifie que ton bloqueur de pubs n\'empeche pas Turnstile, puis reessaye.');
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
    };

    const headerTitle = view === 'signup-success'
        ? 'Verification envoyee'
        : mode === 'login' ? 'Connexion' : 'Inscription';

    const renderContent = () => {
        if (view === 'signup-success') {
            return (
                <SignupSuccessView
                    email={formData.email}
                    resending={resending}
                    onResend={handleResendVerification}
                    onBackToLogin={() => { setMode('login'); resetForm(); }}
                />
            );
        }
        if (view === 'reset-sent') {
            return <ResetSentView email={formData.email} onBackToLogin={() => { setView('form'); setError(''); }} />;
        }
        if (view === 'forgot-password') {
            return (
                <ResetPasswordForm
                    email={formData.email}
                    onEmailChange={(v) => setFormData({ ...formData, email: v })}
                    error={error}
                    loading={loading}
                    turnstileLoading={turnstileLoading}
                    turnstileError={turnstileError}
                    turnstileErrorMsg={turnstileErrorMsg}
                    onSubmit={handleForgotPasswordSubmit}
                    onBack={() => { setView('form'); setError(''); }}
                />
            );
        }
        if (mode === 'login') {
            return (
                <LoginForm
                    email={formData.email}
                    onEmailChange={(v) => setFormData({ ...formData, email: v })}
                    password={formData.password}
                    onPasswordChange={(v) => setFormData({ ...formData, password: v })}
                    showPassword={showPassword}
                    onTogglePassword={() => setShowPassword(!showPassword)}
                    error={error}
                    loading={loading}
                    turnstileLoading={turnstileLoading}
                    turnstileErrorMsg={turnstileErrorMsg}
                    onSubmit={handleSubmit}
                    onGoogleLogin={handleGoogleLogin}
                    onForgotPassword={() => setView('forgot-password')}
                    onSwitchToSignup={() => { setMode('signup'); setError(''); }}
                />
            );
        }
        return (
            <RegisterForm
                name={formData.name}
                onNameChange={(v) => setFormData({ ...formData, name: v })}
                email={formData.email}
                onEmailChange={(v) => setFormData({ ...formData, email: v })}
                password={formData.password}
                onPasswordChange={(v) => setFormData({ ...formData, password: v })}
                confirmPassword={formData.confirmPassword}
                onConfirmPasswordChange={(v) => setFormData({ ...formData, confirmPassword: v })}
                showPassword={showPassword}
                onTogglePassword={() => setShowPassword(!showPassword)}
                error={error}
                loading={loading}
                turnstileLoading={turnstileLoading}
                turnstileErrorMsg={turnstileErrorMsg}
                passwordRules={passwordRules}
                isSignupFormValid={isSignupFormValid}
                onSubmit={handleSubmit}
                onSwitchToLogin={() => { setMode('login'); setError(''); }}
            />
        );
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <button
                type="button"
                aria-label="Fermer"
                className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-pointer"
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
                        {headerTitle}
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
                    {renderContent()}
                </div>
            </div>
        </div>
    );
}
