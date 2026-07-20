import { Lock } from 'lucide-react';

interface Props {
  error: string;
  sending: boolean;
  done: boolean;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}

export function PasswordChangeForm({ error, sending, done, onSubmit }: Props) {
  return (
    <div className="p-5 rounded-2xl bg-secondary/15 border border-border/40">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-secondary/50 flex items-center justify-center">
          <Lock className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="text-sm font-semibold text-foreground">Mot de passe</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="password"
          name="currentPw"
          placeholder="Mot de passe actuel"
          required
          className="w-full h-10 bg-secondary/50 border border-border rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
        />
        <div className="flex gap-2">
          <input
            type="password"
            name="newPw"
            placeholder="Nouveau mot de passe"
            required
            className="flex-1 h-10 bg-secondary/50 border border-border rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          />
          <input
            type="password"
            name="confirmPw"
            placeholder="Confirmer"
            required
            className="flex-1 h-10 bg-secondary/50 border border-border rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={sending}
          className="w-full h-10 rounded-xl text-sm font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-all disabled:opacity-50 cursor-pointer"
        >
          {sending ? 'Enregistrement...' : done ? 'Modifie' : 'Modifier le mot de passe'}
        </button>
      </form>
    </div>
  );
}
