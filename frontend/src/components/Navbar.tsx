import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
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
  const linksRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const [pathname, setPathname] = useState('/');

  const [user, setUser] = useState<UserData | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const PILL_PADDING = 6;

  const moveIndicator = useCallback((path: string, animate: boolean) => {
    const container = linksRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;

    // Hide below the lg breakpoint (1024px) — no mobile menu yet
    if (window.innerWidth < 1024) {
      indicator.style.opacity = '0';
      return;
    }

    const target = container.querySelector<HTMLElement>(`[data-href="${path}"]`);
    if (!target) return;

    const targetRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const left = `${targetRect.left - containerRect.left - PILL_PADDING}px`;
    const width = `${targetRect.width + PILL_PADDING * 2}px`;

    // Only enable transition on explicit navigation (animate=true).
    // Background recalcs (resize, fonts) keep the existing transition alive.
    if (animate) {
      indicator.style.transition = `left 550ms cubic-bezier(0.34, 1.56, 0.64, 1), width 550ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 250ms`;
    }
    indicator.style.left = left;
    indicator.style.width = width;
    indicator.style.opacity = '1';
  }, []);

  // 1) Initial position BEFORE paint — zero flash on mount
  useLayoutEffect(() => {
    const curPath = window.location.pathname;
    setPathname(curPath);
    moveIndicator(curPath, false);
  }, [moveIndicator]);

  // 2) Web fonts can shift text width once loaded
  useEffect(() => {
    document.fonts?.ready.then(() => moveIndicator(window.location.pathname, false));
  }, [moveIndicator]);

  // 3) Astro navigation (component persists, so we listen ourselves)
  useEffect(() => {
    const onSwap = () => {
      const curPath = window.location.pathname;
      setPathname(curPath);
      moveIndicator(curPath, true);
    };
    document.addEventListener('astro:after-swap', onSwap);
    return () => document.removeEventListener('astro:after-swap', onSwap);
  }, [moveIndicator]);

  // 4) Resize / breakpoint crossing
  useEffect(() => {
    if (!linksRef.current) return;
    const ro = new ResizeObserver(() => moveIndicator(window.location.pathname, false));
    ro.observe(linksRef.current);
    return () => ro.disconnect();
  }, [moveIndicator]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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

  return (
    <>
      <div className="sticky top-4 z-40 w-full px-4">
        <nav
          className={`max-w-7xl mx-auto h-[58px] rounded-2xl transition-all duration-300 overflow-hidden ${
            scrolled
              ? 'bg-background/85 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.6)]'
              : 'bg-background/40 backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.3)]'
          }`}
        >
          <div className="h-full flex items-center justify-between px-4 sm:px-5 gap-3">
          {/* Logo + Nav links in same container for sliding indicator */}
          <div className="flex items-center relative" ref={linksRef}>
            <div
              ref={indicatorRef}
              className="absolute top-1/2 -translate-y-1/2 rounded-full pointer-events-none opacity-0"
              style={{
                height: '36px',
                background: 'rgba(255,255,255,0.06)',
                backdropFilter: 'blur(16px) saturate(200%)',
                WebkitBackdropFilter: 'blur(16px) saturate(200%)',
                border: '1px solid rgba(255,255,255,0.10)',
                boxShadow: 'inset 0 1px 1.5px rgba(255,255,255,0.12), 0 4px 16px rgba(0,0,0,0.20)',
              }}
            />
            <a
              href="/"
              data-href="/"
              className={`relative z-10 flex items-center shrink-0 px-3 py-1.5 mr-4 text-[13px] transition-all duration-200 ${
                pathname === '/'
                  ? 'text-primary drop-shadow-[0_0_8px_rgba(59,130,246,0.35)] font-bold'
                  : 'text-muted-foreground hover:text-foreground hover:drop-shadow-[0_0_4px_rgba(255,255,255,0.06)] font-medium'
              }`}
            >
              <span
                className="text-[17px] font-display font-bold tracking-tight block transition-all duration-200"
                style={{
                  background: 'linear-gradient(135deg,#60a5fa 0%,#3b82f6 50%,#2563eb 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  transform: pathname === '/' ? 'scale(1.07)' : 'none',
                  textShadow: pathname === '/' ? '0 0 14px rgba(59,130,246,0.35)' : 'none',
                }}
              >
                WebMedia
              </span>
            </a>
            <div className="hidden lg:flex items-center gap-0.5">
              {navLinks.map(link => (
                <a
                  key={link.href}
                  data-href={link.href}
                  href={link.href}
                  className={`relative z-10 px-3 xl:px-3.5 py-1.5 text-[13px] transition-all duration-200 ${
                    pathname === link.href
                      ? 'text-primary drop-shadow-[0_0_8px_rgba(59,130,246,0.35)] font-semibold'
                      : 'text-muted-foreground hover:text-foreground font-medium'
                  }`}
                >
                  <span
                    className="block transition-all duration-200"
                    style={{
                      transform: pathname === link.href ? 'scale(1.07)' : 'none',
                      textShadow: pathname === link.href ? '0 0 12px rgba(59,130,246,0.35)' : 'none',
                    }}
                  >
                    {link.label}
                  </span>
                </a>
              ))}
            </div>
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
      </div>

      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onLogin={handleLogin} />
    </>
  );
}
