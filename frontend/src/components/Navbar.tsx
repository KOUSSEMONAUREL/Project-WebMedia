import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Search, Bell, Star, Command } from 'lucide-react';
import { AuthModal } from './AuthModal';
import { ProfileDropdown } from './ProfileDropdown';
import { LanguageSwitcher } from './language-switcher';
import type { Media } from '@/lib/api';
import { searchMedia } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { authStore } from '@/stores/auth';
import ErrorBoundary from './ErrorBoundary';
import { bootstrapTranslate } from '@/lib/translate-init';

const PAGE_URL = typeof window !== 'undefined' ? window.location.href : '(ssr)';

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

export function Navbar({ initialPathname = typeof window !== 'undefined' ? window.location.pathname : '/' }: { initialPathname?: string }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Media[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const linksRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const lastScrollRef = useRef(0);
  const [pathname, setPathname] = useState(initialPathname);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    console.log('[Navbar] mounted', PAGE_URL);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const { data: session, isPending } = authClient.useSession();
  const sessionUser = session?.user;
  const user: UserData | null = sessionUser
    ? { name: sessionUser.name, email: sessionUser.email, avatar: sessionUser.image || undefined }
    : null;

  useEffect(() => {
    if (sessionUser) {
      authStore.setSession({
        id: sessionUser.id,
        email: sessionUser.email,
        username: sessionUser.name,
        avatar: sessionUser.image || undefined,
        emailVerified: sessionUser.emailVerified,
      });
    }
  }, [sessionUser]);

  const PILL_PADDING = 6;

  const moveIndicator = useCallback((path: string, animate: boolean) => {
    const container = linksRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;

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

    if (animate) {
      indicator.style.transition = `left 550ms cubic-bezier(0.34, 1.56, 0.64, 1), width 550ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 250ms`;
    }
    indicator.style.left = left;
    indicator.style.width = width;
    indicator.style.opacity = '1';
  }, []);

  useLayoutEffect(() => {
    const curPath = window.location.pathname;
    setPathname(curPath);
    moveIndicator(curPath, false);
  }, [moveIndicator]);

  useEffect(() => {
    document.fonts?.ready.then(() => moveIndicator(window.location.pathname, false));
  }, [moveIndicator]);

  useEffect(() => {
    const onSwap = () => {
      const curPath = window.location.pathname;
      setPathname(curPath);
      moveIndicator(curPath, true);
    };
    document.addEventListener('astro:after-swap', onSwap);
    return () => document.removeEventListener('astro:after-swap', onSwap);
  }, [moveIndicator]);

  useEffect(() => {
    if (!linksRef.current) return;
    const ro = new ResizeObserver(() => moveIndicator(window.location.pathname, false));
    ro.observe(linksRef.current);
    return () => ro.disconnect();
  }, [moveIndicator]);

  useEffect(() => {
    const onScroll = () => {
      const cur = window.scrollY;
      setScrolled(cur > 12);

      if (cur <= 0) {
        setHidden(false);
        lastScrollRef.current = 0;
        return;
      }

      const delta = cur - lastScrollRef.current;
      if (delta > 8) {
        setHidden(true);
      } else if (delta < -8) {
        setHidden(false);
      }

      lastScrollRef.current = cur;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleLogin = (userData: UserData) => {
    localStorage.setItem('webmedia_user', JSON.stringify({
      id: 'session',
      email: userData.email,
      username: userData.name,
      avatar: userData.avatar,
    }));
  };

  const handleLogout = async () => {
    await authClient.signOut();
    localStorage.removeItem('webmedia_user');
  };

  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  function pathToTypeFilter(p: string): string | null {
    return ({
      '/films': 'film',
      '/series': 'serie',
      '/animes': 'anime',
      '/games': 'jeu',
      '/webtoons': 'webtoon',
      '/books': 'book',
      '/novels': 'novel',
    } as Record<string, string>)[p] || null;
  }

  const typeFilter = pathToTypeFilter(pathname);

  useEffect(function() {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (searchQuery.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      const res = await searchMedia(searchQuery, typeFilter ? { type: typeFilter } : undefined);
      setSuggestions(res.data?.slice(0, 6) || []);
      setShowSuggestions(true);
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery, typeFilter]);

  const navContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      // Ferme la barre de recherche si clic en dehors
      if (searchRef.current && !searchRef.current.contains(target)) {
        setShowSuggestions(false);
      }
      // Ferme le menu mobile si clic en dehors du container nav
      if (navContainerRef.current && !navContainerRef.current.contains(target)) {
        setIsMobileMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => { bootstrapTranslate(); }, []);

  return (
    <ErrorBoundary name="Navbar">
      <div ref={navContainerRef} className={`fixed top-0 left-0 right-0 z-40 px-4 pt-4 transition-transform duration-300 ${hidden ? '-translate-y-full' : 'translate-y-0'}`} suppressHydrationWarning>
        <nav
          className={`max-w-7xl mx-auto h-[58px] rounded-2xl transition-all duration-300 ${
            scrolled
              ? 'bg-background/85 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.6)]'
              : 'bg-background/40 backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.3)]'
          }`}
        >
          <div className="h-full flex items-center justify-between px-4 sm:px-5 gap-3">
          <div className="flex items-center relative" ref={linksRef}>
            {/* Bouton Menu Burger sur Mobile */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label={isMobileMenuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
              className={`lg:hidden flex flex-col items-center justify-center gap-[5px] w-9 h-9 shrink-0 mr-1 rounded-xl transition-all duration-200 cursor-pointer ${
                isMobileMenuOpen
                  ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
                  : 'text-muted-foreground hover:bg-white/[0.06] hover:text-foreground'
              }`}
            >
              <span className={`block h-[2px] rounded-full bg-current transition-all duration-300 origin-center ${
                isMobileMenuOpen ? 'w-4 rotate-45 translate-y-[7px]' : 'w-4'
              }`} />
              <span className={`block h-[2px] rounded-full bg-current transition-all duration-300 ${
                isMobileMenuOpen ? 'w-0 opacity-0' : 'w-3'
              }`} />
              <span className={`block h-[2px] rounded-full bg-current transition-all duration-300 origin-center ${
                isMobileMenuOpen ? 'w-4 -rotate-45 -translate-y-[7px]' : 'w-4'
              }`} />
            </button>

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
              onClick={() => setIsMobileMenuOpen(false)}
              className={`relative z-10 flex items-center shrink-0 px-3 py-1.5 mr-2 text-[13px] transition-all duration-200 ${
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

          <div className="relative w-28 sm:w-36 md:w-44 lg:w-36 xl:w-48 focus-within:w-36 focus-within:sm:w-48 focus-within:md:w-60 focus-within:lg:w-56 focus-within:xl:w-72 transition-all duration-200 shrink-0" ref={searchRef}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => searchQuery.length >= 2 && setShowSuggestions(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchQuery.length >= 2) {
                    const p = typeFilter ? `&type=${typeFilter}` : '';
                    window.location.href = `/search?q=${encodeURIComponent(searchQuery)}${p}`;
                  }
                }}
                maxLength={200}
                placeholder="Rechercher..."
                className="w-full h-9 bg-white/[0.04] border border-border/50 rounded-lg pl-9 pr-8 text-[13px] placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40 focus:bg-white/[0.06] focus:ring-1 focus:ring-primary/20 focus:shadow-[0_0_20px_rgba(59,130,246,0.08)] transition-all"
              />
              <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden md:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium text-muted-foreground/40 border border-border/30 pointer-events-none">
                <Command className="h-2.5 w-2.5" />K
              </kbd>

              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-card/95 backdrop-blur-xl border border-border/60 rounded-xl shadow-2xl overflow-hidden z-50 animate-fade-in">
                  {suggestions.map((item) => (
                    <a
                      key={item.id}
                      href={`/${item.type}/${item.slug}`}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.04] transition-colors border-b border-border/20 last:border-0"
                      onClick={() => { setShowSuggestions(false); setSearchQuery(''); }}
                    >
                      <img
                        src={item.posterUrl}
                        alt={item.title}
                        className="w-8 h-12 object-cover rounded-md shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
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
                    href={`/search?q=${encodeURIComponent(searchQuery)}${typeFilter ? `&type=${typeFilter}` : ''}`}
                    className="block px-3 py-2.5 text-center text-[12px] text-primary font-medium hover:bg-white/[0.04] transition-colors border-t border-border/20"
                    onClick={() => { setShowSuggestions(false); setSearchQuery(''); }}
                  >
                    Voir tous les résultats pour &ldquo;{searchQuery}&rdquo;
                  </a>
                </div>
              )}

              {showSuggestions && searchQuery.length >= 2 && suggestions.length === 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-card/95 backdrop-blur-xl border border-border/60 rounded-xl shadow-2xl p-4 text-center z-50 animate-fade-in">
                  <p className="text-muted-foreground text-[13px]">Aucun résultat pour &ldquo;{searchQuery}&rdquo;</p>
                </div>
              )}
            </div>
          </div>

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
            <div className="hidden sm:flex items-center gap-1">
              <LanguageSwitcher />
              <ProfileDropdown
                user={user}
                onLoginClick={() => setShowAuthModal(true)}
                onLogout={handleLogout}
              />
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Menu Panel */}
      {isMobileMenuOpen && (
        <div className="fixed top-[74px] left-4 right-4 bg-background/95 backdrop-blur-2xl border border-border/50 rounded-2xl p-4 shadow-[0_16px_48px_rgba(0,0,0,0.8)] z-50 animate-in fade-in slide-in-from-top-4 duration-300 lg:hidden">
          <div className="flex flex-col gap-1.5">
            {navLinks.map(link => (
              <a
                key={link.href}
                href={link.href}
                className={`flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 ${
                  pathname === link.href
                    ? 'bg-primary/10 text-primary font-bold shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]'
                    : 'text-muted-foreground hover:bg-white/[0.03] hover:text-foreground font-medium'
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <span className="text-[14px]">{link.label}</span>
                {pathname === link.href && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px rgba(59,130,246,0.8)]" />
                )}
              </a>
            ))}
          </div>
          <div className="sm:hidden border-t border-border/40 mt-3 pt-3 flex items-center justify-between">
            <LanguageSwitcher />
            <ProfileDropdown
              user={user}
              onLoginClick={() => setShowAuthModal(true)}
              onLogout={handleLogout}
            />
          </div>
        </div>
      )}
      </div>

      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onLogin={handleLogin} />
    </ErrorBoundary>
  );
}
