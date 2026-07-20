import { SignupSuccessView, ResetSentView } from './AuthSuccessViews';
import { ResetPasswordForm } from './ResetPasswordForm';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';

type ViewState = 'form' | 'signup-success' | 'forgot-password' | 'reset-sent';

interface AuthModalContentProps {
  view: ViewState;
  mode: 'login' | 'signup';
  formData: { name: string; email: string; password: string; confirmPassword: string };
  error: string;
  loading: boolean;
  resending: boolean;
  showPassword: boolean;
  turnstileLoading: boolean;
  turnstileError: boolean;
  turnstileErrorMsg: string | null;
  passwordRules: { minMax: boolean; upper: boolean; lower: boolean; digit: boolean; special: boolean; match: boolean };
  isSignupFormValid: boolean;
  setMode: (m: 'login' | 'signup') => void;
  setView: (v: ViewState) => void;
  setError: (e: string) => void;
  setFormData: (d: any) => void;
  setShowPassword: (s: boolean) => void;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  handleGoogleLogin: () => Promise<void>;
  handleForgotPasswordSubmit: (e: React.FormEvent) => Promise<void>;
  handleResendVerification: () => Promise<void>;
  resetForm: () => void;
}

export function AuthModalContent(props: AuthModalContentProps) {
  const {
    view, mode, formData, error, loading, resending, showPassword,
    turnstileLoading, turnstileError, turnstileErrorMsg,
    passwordRules, isSignupFormValid,
    setMode, setView, setError, setFormData, setShowPassword,
    handleSubmit, handleGoogleLogin, handleForgotPasswordSubmit,
    handleResendVerification, resetForm,
  } = props;

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
}
