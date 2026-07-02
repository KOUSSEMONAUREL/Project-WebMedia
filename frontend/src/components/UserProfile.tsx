import { useState, useEffect } from 'react';
import { authClient } from '@/lib/auth-client';
import { Heart, Clock, Film, Tv, Library, LogOut, Star } from 'lucide-react';
import { allMockData } from '../lib/api';
import type { Media } from '../lib/api';
import { EmptyState } from './EmptyState';

function getLocalIds(key: string): string[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}

export function UserProfile() {
  const [favCount, setFavCount] = useState(0);
  const [wlCount, setWlCount] = useState(0);
  const [recentItems, setRecentItems] = useState<Media[]>([]);

  const { data: session, isPending } = authClient.useSession();
  const sessionUser = session?.user;

  useEffect(() => {
    const favIds = getLocalIds('webmedia_favorites');
    const wlIds = getLocalIds('webmedia_watchlist');
    setFavCount(favIds.length);
    setWlCount(wlIds.length);
    const mediaMap: Record<string, Media> = {};
    for (const m of allMockData) mediaMap[m.id] = m;
    const combined = [...new Set([...favIds, ...wlIds])].slice(0, 6);
    setRecentItems(combined.map(id => mediaMap[id]).filter(Boolean));
  }, []);

  const currentUser = sessionUser ? {
    id: sessionUser.id,
    email: sessionUser.email,
    username: sessionUser.name,
    avatar: sessionUser.image || undefined,
  } : null;

  if (!currentUser) {
    return (
      <div className="container mx-auto px-6 pt-24 pb-16">
        <EmptyState title="Non connecté" description="Connectez-vous pour accéder à votre profil." action={{ label: "Retour à l'accueil", href: '/' }} />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 pt-16 pb-16 animate-fade-in">
      <div className="relative mb-10">
        <div className="h-48 bg-gradient-to-br from-primary/30 via-primary/20 to-primary/10 rounded-2xl" />
        <div className="absolute -bottom-12 left-8 flex items-end gap-6">
          <div className="h-28 w-28 rounded-full border-4 border-background overflow-hidden bg-card shadow-lg">
            <img
              src={currentUser.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${currentUser.email}`}
              alt={currentUser.username}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="mb-4">
            <h1 className="text-3xl font-black text-white">{currentUser.username}</h1>
            <p className="text-muted-foreground">{currentUser.email}</p>
          </div>
        </div>
      </div>

      <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        <div className="glass rounded-xl p-5 text-center">
          <div className="flex items-center justify-center gap-2 text-blue-500 mb-2">
            <Heart className="h-5 w-5 fill-current" />
            <span className="text-2xl font-black">{favCount}</span>
          </div>
          <p className="text-sm text-muted-foreground">Favoris</p>
        </div>
        <div className="glass rounded-xl p-5 text-center">
          <div className="flex items-center justify-center gap-2 text-purple-500 mb-2">
            <Clock className="h-5 w-5" />
            <span className="text-2xl font-black">{wlCount}</span>
          </div>
          <p className="text-sm text-muted-foreground">À voir</p>
        </div>
        <div className="glass rounded-xl p-5 text-center">
          <div className="flex items-center justify-center gap-2 text-pink-500 mb-2">
            <Star className="h-5 w-5 fill-current" />
            <span className="text-2xl font-black">{favCount + wlCount}</span>
          </div>
          <p className="text-sm text-muted-foreground">Total sauvegardé</p>
        </div>
        <div className="glass rounded-xl p-5 text-center">
          <div className="flex items-center justify-center gap-2 text-green-500 mb-2">
            <Film className="h-5 w-5" />
            <span className="text-2xl font-black">2025</span>
          </div>
          <p className="text-sm text-muted-foreground">Membre depuis</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 glass rounded-xl p-6">
          <h2 className="text-xl font-display font-semibold mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Activite récente
          </h2>
          {recentItems.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">Ajoutez des favoris pour voir votre activité.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {recentItems.map(m => (
                <a key={m.id} href={`/${m.type}/${m.slug}`} className="group flex flex-col gap-2 card-lift">
                  <div className="aspect-[2/3] rounded-xl overflow-hidden border border-white/5">
                    <img src={m.posterUrl} alt={m.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  </div>
                  <p className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors">{m.title}</p>
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 rounded-xl p-6">
            <h3 className="text-lg font-display font-semibold mb-2">Passez Premium</h3>
            <p className="text-sm text-muted-foreground mb-4">Téléchargements illimités, pas de pubs, contenu exclusif.</p>
            <button className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-bold text-sm hover:brightness-110 transition-all">
              Découvrir
            </button>
          </div>

          <button
            onClick={() => { authClient.signOut(); window.location.reload(); }}
            className="flex items-center justify-center gap-2 w-full py-2.5 text-sm text-red-500 rounded-lg border border-red-500/20 hover:bg-red-500/10 transition-all"
          >
            <LogOut className="h-4 w-4" />
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}
