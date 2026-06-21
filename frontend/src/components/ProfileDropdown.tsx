import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { User, LogOut, Heart, Clock, Settings, ChevronDown, Film, Tv, Library, BarChart3 } from 'lucide-react';

interface UserData {
    name: string;
    email: string;
    avatar?: string;
}

interface ProfileDropdownProps {
    user: UserData | null;
    onLoginClick: () => void;
    onLogout: () => void;
}

export function ProfileDropdown({ user, onLoginClick, onLogout }: ProfileDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Fermer au clic extérieur
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Stats mockées pour l'utilisateur connecté
    const userStats = {
        films: 42,
        series: 18,
        animes: 27,
        watchTime: '312h'
    };

    if (!user) {
        return (
            <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground"
                onClick={onLoginClick}
            >
                <User className="h-5 w-5" />
            </Button>
        );
    }

    return (
        <div className="relative" ref={dropdownRef}>
            <Button
                variant="ghost"
                className="flex items-center gap-2 px-2 text-muted-foreground hover:text-foreground"
                onClick={() => setIsOpen(!isOpen)}
            >
                <img
                    src={user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`}
                    alt={user.name}
                    className="h-8 w-8 rounded-full bg-secondary"
                />
                <span className="hidden md:block text-sm font-medium text-foreground">{user.name}</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </Button>

            {isOpen && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-card border border-border rounded-xl shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                    {/* Header avec infos utilisateur */}
                    <div className="p-4 bg-gradient-to-br from-primary/10 to-primary/5 border-b border-border">
                        <div className="flex items-center gap-3">
                            <img
                                src={user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`}
                                alt={user.name}
                                className="h-12 w-12 rounded-full bg-secondary border-2 border-primary/50"
                            />
                            <div className="flex-1 min-w-0">
                                <p className="font-bold text-foreground truncate">{user.name}</p>
                                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                            </div>
                        </div>
                    </div>

                    {/* Stats rapides */}
                    <div className="grid grid-cols-4 gap-1 p-3 bg-secondary/30 border-b border-border">
                        <div className="text-center">
                            <div className="flex items-center justify-center gap-1 text-blue-500">
                                <Film className="h-3 w-3" />
                                <span className="text-sm font-bold">{userStats.films}</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground">Films</p>
                        </div>
                        <div className="text-center">
                            <div className="flex items-center justify-center gap-1 text-purple-500">
                                <Tv className="h-3 w-3" />
                                <span className="text-sm font-bold">{userStats.series}</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground">Séries</p>
                        </div>
                        <div className="text-center">
                            <div className="flex items-center justify-center gap-1 text-pink-500">
                                <Library className="h-3 w-3" />
                                <span className="text-sm font-bold">{userStats.animes}</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground">Animés</p>
                        </div>
                        <div className="text-center">
                            <div className="flex items-center justify-center gap-1 text-green-500">
                                <BarChart3 className="h-3 w-3" />
                                <span className="text-sm font-bold">{userStats.watchTime}</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground">Temps</p>
                        </div>
                    </div>

                    {/* Menu items */}
                    <nav className="p-2">
                        <a
                            href="/profile"
                            className="flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-secondary transition-colors"
                            onClick={() => setIsOpen(false)}
                        >
                            <User className="h-4 w-4 text-muted-foreground" />
                            <span>Mon Profil</span>
                        </a>
                        <a
                            href="/favorites"
                            className="flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-secondary transition-colors"
                            onClick={() => setIsOpen(false)}
                        >
                            <Heart className="h-4 w-4 text-muted-foreground" />
                            <span>Mes Favoris</span>
                        </a>
                        <a
                            href="/watchlist"
                            className="flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-secondary transition-colors"
                            onClick={() => setIsOpen(false)}
                        >
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <span>À voir plus tard</span>
                        </a>
                        <a
                            href="/settings"
                            className="flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-secondary transition-colors"
                            onClick={() => setIsOpen(false)}
                        >
                            <Settings className="h-4 w-4 text-muted-foreground" />
                            <span>Paramètres</span>
                        </a>
                    </nav>

                    {/* Logout */}
                    <div className="p-2 border-t border-border">
                        <button
                            onClick={() => {
                                onLogout();
                                setIsOpen(false);
                            }}
                            className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-red-500 rounded-lg hover:bg-red-500/10 transition-colors"
                        >
                            <LogOut className="h-4 w-4" />
                            <span>Déconnexion</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
