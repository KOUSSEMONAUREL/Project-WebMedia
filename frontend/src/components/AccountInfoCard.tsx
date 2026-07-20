import { LogOut } from 'lucide-react';

interface Props {
  username: string;
  email: string;
  avatar?: string;
  onLogout: () => void;
}

export function AccountInfoCard({ username, email, avatar, onLogout }: Props) {
  return (
    <div className="flex items-center gap-4 mb-8 p-5 rounded-2xl bg-secondary/15 border border-border/40">
      <div className="h-14 w-14 rounded-full overflow-hidden bg-card border-2 border-primary/30 shrink-0">
        <img
          src={avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`}
          alt=""
          className="h-full w-full object-cover"
        />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-base font-display font-semibold text-foreground truncate">{username}</h2>
        <p className="text-sm text-muted-foreground truncate">{email}</p>
      </div>
      <button
        type="button"
        onClick={onLogout}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-red-950/20 text-red-400 hover:bg-red-950/40 border border-red-500/20 transition-all cursor-pointer"
      >
        <LogOut className="h-4 w-4" />
        Deconnexion
      </button>
    </div>
  );
}
