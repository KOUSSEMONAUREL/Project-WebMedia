import { useState, useMemo } from 'react';
import { authClient, sendVerificationEmail } from '@/lib/auth-client';
import { authStore } from '@/stores/auth';
import { useTurnstile } from './Turnstile';
import { AuthModalShell } from './AuthModalShell';
import { AuthModalContent } from './AuthModalContent';

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

    return (
        <AuthModalShell title={headerTitle} onClose={onClose}>
            <AuthModalContent
                view={view}
                mode={mode}
                formData={formData}
                error={error}
                loading={loading}
                resending={resending}
                showPassword={showPassword}
                turnstileLoading={turnstileLoading}
                turnstileError={turnstileError}
                turnstileErrorMsg={turnstileErrorMsg}
                passwordRules={passwordRules}
                isSignupFormValid={isSignupFormValid}
                setMode={setMode}
                setView={setView}
                setError={setError}
                setFormData={setFormData}
                setShowPassword={setShowPassword}
                handleSubmit={handleSubmit}
                handleGoogleLogin={handleGoogleLogin}
                handleForgotPasswordSubmit={handleForgotPasswordSubmit}
                handleResendVerification={handleResendVerification}
                resetForm={resetForm}
            />
        </AuthModalShell>
    );
}
