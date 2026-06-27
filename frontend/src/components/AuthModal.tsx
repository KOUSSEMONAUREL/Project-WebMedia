import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { X, Mail, Lock, User as UserIcon, Eye, EyeOff, Github, Chrome } from 'lucide-react';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    onLogin: (user: { name: string; email: string; avatar?: string }) => void;
}

export function AuthModal({ isOpen, onClose, onLogin }: AuthModalProps) {
    const [mode, setMode] = useState<'login' | 'signup'>('login');
    const [showPassword, setShowPassword] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        confirmPassword: ''
    });
    const [error, setError] = useState('');

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (mode === 'signup') {
            if (!formData.name.trim()) {
                setError('Veuillez entrer votre nom');
                return;
            }
            if (formData.password !== formData.confirmPassword) {
                setError('Les mots de passe ne correspondent pas');
                return;
            }
            if (formData.password.length < 6) {
                setError('Le mot de passe doit contenir au moins 6 caractères');
                return;
            }
        }

        if (!formData.email.includes('@')) {
            setError('Veuillez entrer un email valide');
            return;
        }

        // Simuler une connexion réussie
        onLogin({
            name: formData.name || formData.email.split('@')[0],
            email: formData.email,
            avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${formData.email}`
        });
        onClose();
    };

    const handleSocialLogin = (provider: string) => {
        // Simuler une connexion sociale
        const mockUser = {
            name: `User ${provider}`,
            email: `user@${provider.toLowerCase()}.com`,
            avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${provider}`
        };
        onLogin(mockUser);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
            {/* Overlay */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative w-full max-w-md mx-4 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header avec gradient */}
                <div className="relative h-24 bg-gradient-to-br from-primary/80 via-primary to-primary/60 flex items-center justify-center">
                    <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0zNiAxOGMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNiIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMSkiIHN0cm9rZS13aWR0aD0iMiIvPjwvZz48L3N2Zz4=')] opacity-30" />
                    <h2 className="text-2xl font-black text-white italic uppercase tracking-tight">
                        {mode === 'login' ? 'Connexion' : 'Inscription'}
                    </h2>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-3 right-3 text-white/80 hover:text-white hover:bg-white/20"
                        onClick={onClose}
                    >
                        <X className="h-5 w-5" />
                    </Button>
                </div>

                {/* Content */}
                <div className="p-6">
                    {/* Avantages pour les non-connectés */}
                    {mode === 'login' && (
                        <div className="mb-6 p-4 bg-secondary/30 rounded-lg border border-border">
                        <p className="text-sm font-medium text-foreground mb-2">Connectez-vous pour :</p>
                        <ul className="text-xs text-muted-foreground space-y-1">
                            <li>Sauvegarder vos favoris</li>
                            <li>Télécharger du contenu</li>
                            <li>Suivre vos séries préférées</li>
                            <li>Voir vos statistiques</li>
                        </ul>
                        </div>
                    )}

                    {/* Social Login */}
                    <div className="flex gap-3 mb-6">
                        <Button
                            variant="outline"
                            className="flex-1 gap-2"
                            onClick={() => handleSocialLogin('Google')}
                        >
                            <Chrome className="h-4 w-4" />
                            Google
                        </Button>
                        <Button
                            variant="outline"
                            className="flex-1 gap-2"
                            onClick={() => handleSocialLogin('GitHub')}
                        >
                            <Github className="h-4 w-4" />
                            GitHub
                        </Button>
                    </div>

                    {/* Divider */}
                    <div className="relative mb-6">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-border"></div>
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-card px-2 text-muted-foreground">ou</span>
                        </div>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {mode === 'signup' && (
                            <div className="relative">
                                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder="Nom d'utilisateur"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
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
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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

                        {error && (
                            <p className="text-sm text-red-500 bg-red-500/10 p-2 rounded-lg">{error}</p>
                        )}

                        <Button type="submit" className="w-full h-11 font-bold">
                            {mode === 'login' ? 'Se connecter' : "S'inscrire"}
                        </Button>
                    </form>

                    {/* Toggle mode */}
                    <p className="mt-6 text-center text-sm text-muted-foreground">
                        {mode === 'login' ? (
                            <>
                                Pas encore de compte ?{' '}
                                <button
                                    onClick={() => setMode('signup')}
                                    className="text-primary font-medium hover:underline"
                                >
                                    S'inscrire
                                </button>
                            </>
                        ) : (
                            <>
                                Déjà un compte ?{' '}
                                <button
                                    onClick={() => setMode('login')}
                                    className="text-primary font-medium hover:underline"
                                >
                                    Se connecter
                                </button>
                            </>
                        )}
                    </p>
                </div>
            </div>
        </div>
    );
}
