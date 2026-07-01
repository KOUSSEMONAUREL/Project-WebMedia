import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Search, Bell, Star } from 'lucide-react';
import { AuthModal } from './AuthModal';
import { ProfileDropdown } from './ProfileDropdown';
import { allMockData } from '@/lib/mockData';
import type { Media } from '@/lib/api';

const navLinks = [
  { label: 'Films', href: '/films' },
  { label: 'Séries', href: '/series' },
  { label: 'Animés', href: '/animes' },
  { label: 'Jeux', href: '/games' },
  { label: 'Webtoons', href: '/webtoons' },
  { label: 'Livres', href: '/books' },
  { label: 'Light Novels', href: '/novels' },
];

const typeColors: Record<string, string> = {
  film:    'bg-sky-600',
  serie:   'bg-violet-600',
  anime:   'bg-rose-600',
  jeu:     'bg-emerald-600',
  webtoon: 'bg-amber-600',
  book:    'bg-orange-600',
  novel:   'bg-teal-600',
};

interface UserData {
  name: string;
  email: string;
  avatar?: string;
}

export function Navbar() {
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Media[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const [user, setUser] = useState<UserData | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    const savedUser = localStorage.getItem('webmedia_user');
    if (savedUser) setUser(JSON.parse(savedUser));
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
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
    if (searchQuery.length >= 2) {
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

  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';

  return (
    <>
      <nav
        className={`h-[58px] sticky top-0 z-40 w-full transition-all duration-300 ${
          scrolled
            ? 'bg-background/95 backdrop-blur-2xl border-b border-border/50 shadow-[0_1px_32px_rgba(0,0,0,0.5)]'
            : 'bg-background/60 backdrop-blur-xl border-b border-border/20'
        }`}
      >
        <div className="max-w-7xl mx-auto h-full flex items-center justify-between px-4 sm:px-6 gap-4">
          {/* Logo */}
          <a href="/" className="flex items-center shrink-0">
            <span
              className="text-[17px] font-display font-bold tracking-tight"
              style={{
                background: 'linear-gradient(135deg,#60a5fa 0%,#3b82f6 50%,#2563eb 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              WebMedia
            </span>
          </a>

          {/* Desktop nav links */}
          <div className="hidden lg:flex items-center gap-0.5 xl:gap-1">
            {navLinks.map(link => (
              <a
                key={link.href}
                href={link.href}
                className={`px-3 xl:px-3.5 py-1.5 text-[13px] font-medium rounded-md transition-all duration-150 ${
                  pathname === link.href
                    ? 'text-primary bg-primary/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.04]'
                }`}
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Search bar */}
          <div className="relative flex-1 md:flex-initial md:w-40 lg:w-36 xl:w-52 focus-within:md:w-52 focus-within:lg:w-48 focus-within:xl:w-64 transition-all duration-200" ref={searchRef}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => searchQuery.length >= 2 && setShowSuggestions(true)}
                placeholder="Rechercher..."
                className="w-full h-9 bg-white/[0.04] border border-border/60 rounded-lg pl-9 pr-3.5 text-[13px] placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 focus:bg-white/[0.06] focus:ring-1 focus:ring-primary/20 transition-all"
              />

              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border/70 rounded-xl shadow-2xl overflow-hidden z-50">
                  {suggestions.map((item) => (
                    <a
                      key={item.id}
                      href={`/${item.type}/${item.slug}`}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.04] transition-colors border-b border-border/30 last:border-0"
                      onClick={() => { setShowSuggestions(false); setSearchQuery(''); }}
                    >
                      <img
                        src={item.posterUrl}
                        alt={item.title}
                        className="w-8 h-12 object-cover rounded-md shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).src = 'https://via.placeholder.com/32x48?text=?'; }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[13px] text-foreground truncate">{item.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase text-white ${typeColors[item.type] || 'bg-gray-600'}`}>
                            {item.type}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{item.year}</span>
                          <span className="flex items-center text-[11px] text-primary gap-0.5 ml-auto">
                            <Star className="h-2.5 w-2.5 fill-current" />
                            {item.rating}
                          </span>
                        </div>
                      </div>
                    </a>
                  ))}
                  <a
                    href={`/search?q=${encodeURIComponent(searchQuery)}`}
                    className="block px-3 py-2.5 text-center text-[12px] text-primary font-medium hover:bg-white/[0.04] transition-colors"
                  >
                    Voir tous les résultats pour &ldquo;{searchQuery}&rdquo;
                  </a>
                </div>
              )}

              {showSuggestions && searchQuery.length >= 2 && suggestions.length === 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border/70 rounded-xl shadow-2xl p-4 text-center z-50">
                  <p className="text-muted-foreground text-[13px]">Aucun résultat pour &ldquo;{searchQuery}&rdquo;</p>
                </div>
              )}
            </div>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="relative text-muted-foreground hover:text-foreground h-9 w-9"
            >
              <Bell className="h-[17px] w-[17px]" />
              {user && (
                <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 bg-primary rounded-full ring-1 ring-background" />
              )}
            </Button>
            <ProfileDropdown
              user={user}
              onLoginClick={() => setShowAuthModal(true)}
              onLogout={handleLogout}
            />
          </div>
        </div>
      </nav>

      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onLogin={handleLogin} />
    </>
  );
}
