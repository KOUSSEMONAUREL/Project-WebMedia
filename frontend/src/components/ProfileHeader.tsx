import { Heart, Clock, History, LogOut, Settings, Shield } from 'lucide-react';

type TabType = 'favorites' | 'watchlist' | 'history';

interface Props {
  username: string;
  email: string;
  avatar?: string;
  activeTab: TabType;
  favCount: number;
  wlCount: number;
  histCount: number;
  isAdmin: boolean;
  onTabChange: (tab: TabType) => void;
  onLogout: () => void;
}

export function ProfileHeader({ username, email, avatar, activeTab, favCount, wlCount, histCount, isAdmin, onTabChange, onLogout }: Props) {
  return (
    <>
      <div className="relative mb-10 overflow-hidden rounded-3xl bg-secondary/35 border border-border/40 shadow-2xl">
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-primary/15 via-purple-500/5 to-transparent" />
        <div className="h-32 sm:h-40 w-full bg-gradient-to-r from-primary/20 via-blue-600/10 to-transparent" />

        <div className="relative px-6 pb-6 pt-0 flex flex-col md:flex-row md:items-end justify-between gap-6 -mt-10 sm:-mt-14">
          <div className="flex flex-col sm:flex-row items-center sm:items-end gap-5 text-center sm:text-left">
            <div className="h-24 w-24 sm:h-28 sm:w-28 rounded-full border-4 border-background overflow-hidden bg-card shadow-xl shrink-0">
              <img
                src={avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`}
                alt={username}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="mb-2">
              <h1 className="text-2xl sm:text-3xl font-display font-bold text-white flex items-center justify-center sm:justify-start gap-2">
                {username}
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30 tracking-wider">
                  Membre
                </span>
              </h1>
              <p className="text-[13px] text-muted-foreground mt-0.5">{email}</p>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 shrink-0">
            {isAdmin && (
              <a
                href="/admin"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium border border-border hover:bg-white/[0.04] text-foreground transition-all duration-200"
              >
                <Shield className="w-4 h-4 text-muted-foreground" />
                Admin
              </a>
            )}
            <a
              href="/settings"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium border border-border hover:bg-white/[0.04] text-foreground transition-all duration-200"
            >
              <Settings className="w-4 h-4 text-muted-foreground" />
              Reglages
            </a>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold bg-red-950/20 text-red-400 hover:bg-red-950/40 border border-red-500/20 transition-all duration-200"
            >
              <LogOut className="w-4 h-4" />
              Deconnexion
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-8">
        <button
          type="button"
          onClick={() => onTabChange('favorites')}
          className={`flex flex-col items-center justify-center p-4 sm:p-5 rounded-2xl border transition-all ${
            activeTab === 'favorites'
              ? 'bg-primary/10 border-primary/30 text-primary shadow-[0_4px_16px_rgba(59,130,246,0.1)]'
              : 'bg-secondary/20 border-border/40 hover:bg-secondary/40 text-muted-foreground hover:text-foreground'
          }`}
        >
          <Heart className="h-5 w-5 mb-1.5 fill-current" />
          <span className="text-xl sm:text-2xl font-display font-bold text-foreground">{favCount}</span>
          <span className="text-[10px] sm:text-xs uppercase tracking-wider font-semibold mt-0.5">Favoris</span>
        </button>

        <button
          type="button"
          onClick={() => onTabChange('watchlist')}
          className={`flex flex-col items-center justify-center p-4 sm:p-5 rounded-2xl border transition-all ${
            activeTab === 'watchlist'
              ? 'bg-purple-500/10 border-purple-500/30 text-purple-400 shadow-[0_4px_16px_rgba(168,85,247,0.1)]'
              : 'bg-secondary/20 border-border/40 hover:bg-secondary/40 text-muted-foreground hover:text-foreground'
          }`}
        >
          <Clock className="h-5 w-5 mb-1.5" />
          <span className="text-xl sm:text-2xl font-display font-bold text-foreground">{wlCount}</span>
          <span className="text-[10px] sm:text-xs uppercase tracking-wider font-semibold mt-0.5">A voir</span>
        </button>

        <button
          type="button"
          onClick={() => onTabChange('history')}
          className={`flex flex-col items-center justify-center p-4 sm:p-5 rounded-2xl border transition-all ${
            activeTab === 'history'
              ? 'bg-teal-500/10 border-teal-500/30 text-teal-400 shadow-[0_4px_16px_rgba(20,184,166,0.1)]'
              : 'bg-secondary/20 border-border/40 hover:bg-secondary/40 text-muted-foreground hover:text-foreground'
          }`}
        >
          <History className="h-5 w-5 mb-1.5" />
          <span className="text-xl sm:text-2xl font-display font-bold text-foreground">{histCount}</span>
          <span className="text-[10px] sm:text-xs uppercase tracking-wider font-semibold mt-0.5">Historique</span>
        </button>
      </div>
    </>
  );
}
