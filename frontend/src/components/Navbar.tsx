import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Search, Menu, X, Bell, Home, Film, Tv, Library, Gamepad2, Heart, Clock, Settings, Compass, Hash, Star, BookOpen, BookMarked, NotebookPen } from 'lucide-react';
import { AuthModal } from './AuthModal';
import { ProfileDropdown } from './ProfileDropdown';
import { allMockData } from '@/lib/mockData';
import type { Media } from '@/lib/api';

const mobileMenuItems = [
    { icon: Home, label: "Accueil", href: "/" },
    { icon: Compass, label: "Découvrir", href: "/discover" },
    { icon: Hash, label: "Genres", href: "/genres" },
    { icon: Film, label: "Films", href: "/films" },
    { icon: Tv, label: "Séries", href: "/series" },
    { icon: Library, label: "Animés", href: "/animes" },
    { icon: Gamepad2, label: "Jeux Vidéo", href: "/games" },
    { icon: BookOpen, label: "Webtoons", href: "/webtoons" },
    { icon: BookMarked, label: "Livres", href: "/books" },
    { icon: NotebookPen, label: "Light Novels", href: "/novels" },
    { icon: Heart, label: "Favoris", href: "/favorites" },
    { icon: Clock, label: "À voir", href: "/watchlist" },
    { icon: Settings, label: "Paramètres", href: "/settings" },
];

interface UserData {
    name: string;
    email: string;
    avatar?: string;
}

export function Navbar() {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [suggestions, setSuggestions] = useState<Media[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);

    const [user, setUser] = useState<UserData | null>(null);
    const [showAuthModal, setShowAuthModal] = useState(false);

    useEffect(() => {
        const savedUser = localStorage.getItem('webmedia_user');
        if (savedUser) setUser(JSON.parse(savedUser));
    }, []);

    const handleLogin = (userData: UserData) => {
        setUser(userData);
        localStorage.setItem('webmedia_user', JSON.stringify(userData));
    };

    const handleLogout = () => {
        setUser(null);
        localStorage.removeItem('webmedia_user');
    };

    useEffect(() => {
        if (searchQuery.length >= 3) {
            const filtered = allMockData.filter(item =>
                item.title.toLowerCase().includes(searchQuery.toLowerCase())
            );
            setSuggestions(filtered.slice(0, 6));
            setShowSuggestions(true);
        } else {
            setSuggestions([]);
            setShowSuggestions(false);
        }
    }, [searchQuery]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
                setShowSuggestions(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const getTypeColor = (type: string) => {
        switch (type) {
            case 'film': return 'bg-blue-600';
            case 'serie': return 'bg-purple-600';
            case 'anime': return 'bg-pink-600';
            case 'jeu': return 'bg-green-600';
            case 'webtoon': return 'bg-orange-600';
            case 'book': return 'bg-amber-600';
            case 'novel': return 'bg-teal-600';
            default: return 'bg-gray-600';
        }
    };

    return (
        <>
            <nav className="h-16 border-b border-border/50 bg-background/40 backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.5)] sticky top-0 z-40 w-full">
                <div className="container h-full flex items-center justify-between px-4 lg:px-6">
                    <Button variant="ghost" size="icon" className="lg:hidden mr-2" onClick={() => setIsOpen(!isOpen)}>
                        {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
                    </Button>

                    <a href="/" className="hidden lg:flex items-center mr-6 shrink-0">
                        <img src="/images/logo.png" alt="WebMedia Logo" className="h-8 w-auto" />
                    </a>

                    <div className="flex-1 max-w-2xl" ref={searchRef}>
                        <div className="relative group">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors z-10" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onFocus={() => searchQuery.length >= 3 && setShowSuggestions(true)}
                                placeholder="Rechercher un film, série, animé..."
                                className="w-full h-10 bg-card/80 border border-border/60 rounded-xl pl-10 pr-4 text-sm focus:outline-none focus:border-primary/50 focus:bg-card focus:shadow-[0_0_20px_rgba(212,175,55,0.08)] transition-all placeholder:text-muted-foreground"
                            />

                            {showSuggestions && suggestions.length > 0 && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-black border border-border shadow-2xl overflow-hidden z-50">
                                    {suggestions.map((item) => (
                                        <a
                                            key={item.id}
                                            href={`/${item.type}/${item.slug}`}
                                            className="flex items-center gap-3 p-3 hover:bg-secondary/50 transition-colors"
                                            onClick={() => { setShowSuggestions(false); setSearchQuery(''); }}
                                        >
                                            <img
                                                src={item.posterUrl}
                                                alt={item.title}
                                                className="w-10 h-14 object-cover rounded"
                                                onError={(e) => { (e.target as HTMLImageElement).src = 'https://via.placeholder.com/40x56?text=?'; }}
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-sm text-foreground truncate">{item.title}</p>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded text-white font-bold uppercase ${getTypeColor(item.type)}`}>
                                                        {item.type}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground">{item.year}</span>
                                                    <span className="flex items-center text-xs text-yellow-500">
                                                        <Star className="h-3 w-3 fill-current mr-0.5" />
                                                        {item.rating}
                                                    </span>
                                                </div>
                                            </div>
                                        </a>
                                    ))}
                                    <a
                                        href={`/search?q=${encodeURIComponent(searchQuery)}`}
                                        className="block p-3 text-center text-sm text-primary font-medium hover:bg-secondary/50 border-t border-border"
                                    >
                                        Voir tous les résultats pour "{searchQuery}"
                                    </a>
                                </div>
                            )}

                            {showSuggestions && searchQuery.length >= 3 && suggestions.length === 0 && (
                                <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-lg shadow-xl p-4 text-center z-50">
                                    <p className="text-muted-foreground text-sm">Aucun résultat pour "{searchQuery}"</p>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-1 ml-2">
                        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground relative">
                            <Bell className="h-5 w-5" />
                            {user && <span className="absolute top-1 right-1 h-2 w-2 bg-primary rounded-full" />}
                        </Button>
                        <ProfileDropdown
                            user={user}
                            onLoginClick={() => setShowAuthModal(true)}
                            onLogout={handleLogout}
                        />
                    </div>
                </div>
            </nav>

            {isOpen && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <div className="fixed inset-0 bg-black/80" onClick={() => setIsOpen(false)} />
                    <div className="fixed top-0 left-0 h-full w-64 bg-black border-r border-border p-4 overflow-y-auto">
                        <div className="flex items-center justify-between mb-6">
                            <img src="/images/logo.png" alt="WebMedia Logo" className="h-10 w-auto" />
                            <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} className="rounded-none">
                                <X className="h-5 w-5" />
                            </Button>
                        </div>
                        <nav className="flex flex-col gap-1">
                            {mobileMenuItems.map((item, i) => (
                                <a
                                    key={i}
                                    href={item.href}
                                    className="flex items-center gap-3 px-3 py-3 text-sm font-medium rounded-md transition-colors hover:bg-secondary hover:text-foreground text-muted-foreground"
                                    onClick={() => setIsOpen(false)}
                                >
                                    <item.icon className="h-5 w-5" />
                                    {item.label}
                                </a>
                            ))}
                        </nav>
                    </div>
                </div>
            )}

            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onLogin={handleLogin} />
        </>
    );
}
