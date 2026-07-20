import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Bell, Search, ArrowLeft } from 'lucide-react';
import { AuthModal } from './AuthModal';
import { ProfileDropdown } from './ProfileDropdown';
import { LanguageSwitcher } from './language-switcher';
import { authClient, useCachedSession, clearUserCache } from '@/lib/auth-client';
import { authStore } from '@/stores/auth';
import ErrorBoundary from './ErrorBoundary';
import { bootstrapTranslate } from '@/lib/translate-init';
import { NavbarSearch } from './NavbarSearch';
import { MobileMenu } from './MobileMenu';

const PAGE_URL = typeof window !== 'undefined' ? window.location.href : '(ssr)';

const navLinks = [
  { label: 'Films', href: '/films' },
  { label: 'Series', href: '/series' },
  { label: 'Animes', href: '/animes' },
  { label: 'Jeux', href: '/games' },
  { label: 'Comics', href: '/comics' },
  { label: 'Webtoons', href: '/webtoons' },
  { label: 'Livres', href: '/books' },
  { label: 'Light Novels', href: '/novels' },
  { label: 'TV Live', href: '/live-tv' },
];

interface UserData {
  name: string;
  email: string;
  avatar?: string;
}

function handleLogin(userData: UserData) {
  localStorage.setItem('webmedia_user:v1', JSON.stringify({
    id: 'session',
    email: userData.email,
    username: userData.name,
    avatar: userData.avatar,
  }));
}

async function handleLogout() {
  clearUserCache();
  await authClient.signOut();
  localStorage.removeItem('webmedia_user:v1');
}

function pathToTypeFilter(p: string): string | null {
  return ({
    '/films': 'film',
    '/series': 'serie',
    '/animes': 'anime',
    '/games': 'jeu',
    '/comics': 'comic',
    '/webtoons': 'webtoon',
    '/books': 'book',
    '/novels': 'novel',
  } as Record<string, string>)[p] || null;
}

export function Navbar({ initialPathname = typeof window !== 'undefined' ? window.location.pathname : '/' }: { initialPathname?: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const linksRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const lastScrollRef = useRef(0);
  const [pathname, setPathname] = useState(initialPathname);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

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

  const { data: session, isPending } = useCachedSession();
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

  const moveIndicator = useCallback((path: string, animate: boolean) => {
    const container = linksRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;

    if (window.innerWidth < 1024) {
      indicator.style.opacity = '0';
      return;
    }

    const normalised = path.replace(/\/$/, '') || '/';
    const target = container.querySelector<HTMLElement>(`[data-href="${normalised}"]`);
    if (!target) return;

    const t = target.getBoundingClientRect();
    const c = container.getBoundingClientRect();

    const w = `${t.width + 12}px`;
    const l = `${t.left - c.left - 6}px`;

    if (animate) {
      indicator.style.transition = `left 550ms cubic-bezier(0.34, 1.56, 0.64, 1), width 550ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 250ms`;
    } else {
      indicator.style.transition = 'none';
    }
    indicator.style.left = l;
    indicator.style.width = w;
    indicator.style.opacity = '1';
  }, []);

  useLayoutEffect(() => {
    const curPath = window.location.pathname.replace(/\/$/, '') || '/';
    setPathname(curPath);
    moveIndicator(curPath, false);
  }, [moveIndicator]);

  useEffect(() => {
    document.fonts?.ready.then(() => moveIndicator(window.location.pathname, true));
  }, [moveIndicator]);

  useEffect(() => {
    const onSwap = () => {
      const curPath = window.location.pathname.replace(/\/$/, '') || '/';
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

  const navContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (navContainerRef.current && !navContainerRef.current.contains(target)) {
        setIsMobileMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => { bootstrapTranslate(); }, []);

  const typeFilter = pathToTypeFilter(pathname);

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
          <div className={`flex items-center relative ${mobileSearchOpen ? 'hidden sm:flex' : ''}`} ref={linksRef}>
            <div
              ref={indicatorRef}
              className="absolute top-1/2 -translate-y-1/2 rounded-full pointer-events-none opacity-0"
              style={{
                height: '36px',
                background: 'rgba(255,255,255,0.06)',
                backdropFilter: 'blur(8px) saturate(200%)',
                WebkitBackdropFilter: 'blur(8px) saturate(200%)',
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
                data-astro-transition-name="logo"
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

          <div className={`${mobileSearchOpen ? 'hidden' : 'hidden sm:block'}`}>
            <NavbarSearch typeFilter={typeFilter} />
          </div>

          <div className={`flex items-center gap-1 shrink-0 ${mobileSearchOpen ? 'hidden sm:flex' : ''}`}>
            <button
              type="button"
              onClick={() => setMobileSearchOpen(true)}
              aria-label="Rechercher"
              className="sm:hidden flex items-center justify-center w-9 h-9 shrink-0 rounded-xl text-muted-foreground hover:bg-white/[0.06] hover:text-foreground transition-all duration-200 cursor-pointer"
            >
              <Search className="h-[17px] w-[17px]" />
            </button>
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label={isMobileMenuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
              className={`lg:hidden flex flex-col items-center justify-center gap-[5px] w-9 h-9 shrink-0 rounded-xl transition-all duration-200 cursor-pointer ${
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
            <Button
              variant="ghost"
              size="icon"
              aria-label="Notifications"
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

          {mobileSearchOpen && (
            <div className="absolute inset-x-0 top-0 h-full flex items-center px-4 gap-2 sm:hidden bg-background/95 backdrop-blur-xl rounded-2xl">
              <button
                type="button"
                onClick={() => setMobileSearchOpen(false)}
                className="flex items-center justify-center w-9 h-9 shrink-0 rounded-xl text-muted-foreground hover:bg-white/[0.06] hover:text-foreground transition-all"
              >
                <ArrowLeft className="h-[17px] w-[17px]" />
              </button>
              <div className="flex-1">
                <NavbarSearch typeFilter={typeFilter} />
              </div>
            </div>
          )}
        </div>
      </nav>

      {isMobileMenuOpen && (
        <MobileMenu
          pathname={pathname}
          user={user}
          onLoginClick={() => setShowAuthModal(true)}
          onLogout={handleLogout}
          onClose={() => setIsMobileMenuOpen(false)}
        />
      )}
      </div>

      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onLogin={handleLogin} />
    </ErrorBoundary>
  );
}
