import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { User, LogOut, ChevronDown, Film, Tv, Library, BarChart3 } from 'lucide-react';

import { getAllFavorites, getWatchlist } from '../lib/indexeddb';

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
    const [stats, setStats] = useState({ films: 0, series: 0, animes: 0, total: 0 });

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

    // Charger les statistiques réelles
    useEffect(() => {
        if (!user || !isOpen) return;
        async function fetchCounts() {
            try {
                const favs = await getAllFavorites();
                const wl = await getWatchlist();
                const combined = [...favs, ...wl];
                const filmCount = combined.filter(m => m.type === 'film').length;
                const serieCount = combined.filter(m => m.type === 'serie').length;
                const animeCount = combined.filter(m => m.type === 'anime').length;
                setStats({ films: filmCount, series: serieCount, animes: animeCount, total: combined.length });
            } catch (err) {
                console.warn('[dropdown-stats] erreur:', err);
            }
        }
        fetchCounts();
    }, [user, isOpen]);

    if (!user) {
        return (
            <button
                className="flex items-center gap-2 px-3.5 py-1.5 text-[13px] font-semibold rounded-full border transition-all duration-200 hover:scale-[1.02]"
                style={{
                    background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 60%, #2563eb 100%)',
                    border: 'none',
                    color: '#ffffff',
                    boxShadow: '0 2px 12px rgba(59,130,246,0.25)',
                }}
                onClick={onLoginClick}
            >
                <User className="h-3.5 w-3.5" />
                Connexion
            </button>
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
                <div className="absolute right-0 top-full mt-2 w-72 bg-card border border-border/70 rounded-2xl shadow-2xl overflow-hidden z-50" style={{boxShadow:'0 24px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)'}}>
                    {/* Header avec infos utilisateur */}
                    <div className="p-4 border-b border-border/50" style={{background:'linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(59,130,246,0.03) 100%)'}}>
                        <div className="flex items-center gap-3">
                            <img
                                src={user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`}
                                alt={user.name}
                                className="h-11 w-11 rounded-xl bg-secondary"
                                style={{border:'2px solid rgba(59,130,246,0.4)'}}
                            />
                            <div className="flex-1 min-w-0">
                                <p className="font-bold text-[14px] text-foreground truncate">{user.name}</p>
                                <p className="text-[11px] text-muted-foreground truncate mt-0.5">{user.email}</p>
                            </div>
                        </div>
                    </div>

                    {/* Stats rapides */}
                    <div className="grid grid-cols-4 gap-px bg-border/40 border-b border-border/50">
                        {[
                            { icon: Film, value: stats.films, label: 'Films' },
                            { icon: Tv, value: stats.series, label: 'Séries' },
                            { icon: Library, value: stats.animes, label: 'Animés' },
                            { icon: BarChart3, value: stats.total, label: 'Total' },
                        ].map((stat) => (
                            <div key={stat.label} className="flex flex-col items-center py-3 bg-card gap-0.5">
                                <span className="text-[13px] font-bold text-foreground">{stat.value}</span>
                                <p className="text-[10px] text-muted-foreground">{stat.label}</p>
                            </div>
                        ))}
                    </div>

                    {/* Menu items */}
                    <nav className="p-1.5">
                        {[
                            { href: '/profile', icon: User, label: 'Mon Profil' },
                        ].map(item => (
                            <a
                                key={item.href}
                                href={item.href}
                                className="flex items-center gap-3 px-3 py-2 text-[13px] rounded-lg hover:bg-white/[0.04] hover:text-foreground text-muted-foreground transition-colors"
                                onClick={() => setIsOpen(false)}
                            >
                                <item.icon className="h-3.5 w-3.5" />
                                <span>{item.label}</span>
                            </a>
                        ))}
                    </nav>

                    {/* Logout */}
                    <div className="p-1.5 border-t border-border/50">
                        <button
                            onClick={() => { onLogout(); setIsOpen(false); }}
                            className="flex items-center gap-3 w-full px-3 py-2 text-[13px] text-red-400 rounded-lg hover:bg-red-500/10 transition-colors"
                        >
                            <LogOut className="h-3.5 w-3.5" />
                            <span>Déconnexion</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
