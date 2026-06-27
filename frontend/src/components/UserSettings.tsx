import { useState, useEffect } from 'react';
import { authStore } from '../stores/auth';
import { LogOut, Trash2, Palette, Info, User, Mail } from 'lucide-react';
import { EmptyState } from './EmptyState';

export function UserSettings() {
  const [user, setUser] = useState(authStore.user);

  useEffect(() => {
    const unsub = authStore.subscribe(() => setUser(authStore.user));
    return unsub;
  }, []);

  const clearFavs = () => {
    localStorage.removeItem('webmedia_favorites');
    window.location.reload();
  };
  const clearWl = () => {
    localStorage.removeItem('webmedia_watchlist');
    window.location.reload();
  };

  if (!user) {
    return (
      <div className="container mx-auto px-6 pt-24 pb-16">
        <EmptyState title="Non connecté" description="Connectez-vous pour accéder aux paramètres." action={{ label: "Retour à l'accueil", href: '/' }} />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 pt-16 pb-16 animate-fade-in">
      <header className="mb-8 text-center">
        <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground">Paramètres</h1>
        <p className="text-muted-foreground mt-1">Gérez votre compte et vos préférences.</p>
        <div className="w-16 h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent mx-auto mt-4" />
      </header>

      <div className="max-w-2xl space-y-6">
        {/* Profile info */}
        <div className="glass rounded-xl p-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="h-16 w-16 rounded-full overflow-hidden bg-card border-2 border-primary/30">
              <img src={user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`} alt="" className="h-full w-full object-cover" />
            </div>
            <div>
              <h3 className="text-lg font-display font-semibold text-foreground">{user.username}</h3>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => { authStore.logout(); window.location.reload(); }}
              className="flex items-center gap-2 bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm font-medium hover:bg-destructive/20 transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Se déconnecter
            </button>
          </div>
        </div>

        {/* Theme */}
        <div className="glass rounded-xl p-6">
          <div className="flex items-center gap-3 mb-1">
            <Palette className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-display font-semibold text-foreground">Thème</h3>
          </div>
          <p className="text-sm text-muted-foreground">Le thème sombre est activé par défaut.</p>
        </div>

        {/* About */}
        <div className="glass rounded-xl p-6">
          <div className="flex items-center gap-3 mb-1">
            <Info className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-display font-semibold text-foreground">À propos</h3>
          </div>
          <p className="text-sm text-muted-foreground">WebMedia — Plateforme de découverte de médias. Version 1.0.0</p>
        </div>

        {/* Local data */}
        <div className="glass rounded-xl p-6">
          <div className="flex items-center gap-3 mb-1">
            <Trash2 className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-display font-semibold text-foreground">Données locales</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">Gérez vos données sauvegardées dans ce navigateur.</p>
          <div className="flex gap-3">
            <button onClick={clearFavs} className="bg-secondary/50 text-foreground px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-secondary transition-colors">
              Vider les favoris
            </button>
            <button onClick={clearWl} className="bg-secondary/50 text-foreground px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-secondary transition-colors">
              Vider la watchlist
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
