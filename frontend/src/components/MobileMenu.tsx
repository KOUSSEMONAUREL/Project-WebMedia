import { LanguageSwitcher } from './language-switcher';
import { ProfileDropdown } from './ProfileDropdown';

interface UserData {
  name: string;
  email: string;
  avatar?: string;
}

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

interface Props {
  pathname: string;
  user: UserData | null;
  onLoginClick: () => void;
  onLogout: () => void;
  onClose: () => void;
}

export function MobileMenu({ pathname, user, onLoginClick, onLogout, onClose }: Props) {
  return (
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
            onClick={onClose}
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
          onLoginClick={onLoginClick}
          onLogout={onLogout}
        />
      </div>
    </div>
  );
}
