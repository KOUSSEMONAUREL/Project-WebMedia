import { useState, useEffect } from 'react';
import { authClient } from '@/lib/auth-client';
import { Heart, Clock, LogOut, Star, History, Settings } from 'lucide-react';
import { getAllFavorites, getWatchlist, getHistory, removeFavorite, removeFromWatchlist } from '../lib/indexeddb';
import type { Favorite, HistoryEntry } from '../lib/indexeddb';
import type { Media } from '../lib/api';
import { MediaCard } from './MediaCard';
import { EmptyState } from './EmptyState';

type TabType = 'favorites' | 'watchlist' | 'history';

export function UserProfile() {
  const [activeTab, setActiveTab] = useState<TabType>('favorites');
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [watchlist, setWatchlist] = useState<Favorite[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const { data: session, isPending } = authClient.useSession();
  const sessionUser = session?.user;

  // Charger les données réelles avec synchronisation Supabase (si authentifié)
  const loadData = async () => {
    try {
      let localFavs = await getAllFavorites();

      if (sessionUser) {
        try {
          const sessionData = await authClient.getSession();
          const token = sessionData?.data?.session?.token;

          const apiBaseUrl = import.meta.env.PUBLIC_API_URL || 'http://localhost:8787/api';
          const headers: Record<string, string> = {};
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }

          const res = await fetch(`${apiBaseUrl}/user/favorites`, { 
            headers,
            credentials: 'include' 
          });
          if (res.ok) {
            const json = await res.json();
            if (json.success && Array.isArray(json.data)) {
              const remoteIds: string[] = json.data.map((f: any) => f.mediaId);
              const localIds = localFavs.map(f => f.id);
              const missingIds = remoteIds.filter(id => !localIds.includes(id));

              if (missingIds.length > 0) {
                const { getMediaDetails } = await import('../lib/api');
                const { addFavorite } = await import('../lib/indexeddb');
                
                for (const id of missingIds) {
                  try {
                    // Tentative d'obtention de métadonnées riches
                    const details = await getMediaDetails('', id);
                    if (details.success && details.data) {
                      const media = details.data;
                      await addFavorite({
                        id: media.id,
                        type: media.type,
                        title: media.title,
                        slug: media.slug || media.id,
                        posterUrl: media.posterUrl,
                        rating: media.rating,
                        year: media.year
                      });
                    }
                  } catch {
                    // Fallback basique
                    await addFavorite({
                      id,
                      type: 'film',
                      title: 'Média de ma bibliothèque',
                      slug: id
                    });
                  }
                }
                // Refetch local
                localFavs = await getAllFavorites();
              }
            }
          }
        } catch (syncErr) {
          console.warn('[sync-profile] Echec de la recuperation des favoris Supabase:', syncErr);
        }
      }

      const wl = await getWatchlist();
      const hist = await getHistory(30);
      setFavorites(localFavs);
      setWatchlist(wl);
      setHistory(hist);
    } catch (err) {
      console.error('Erreur lors du chargement des donnees utilisateur:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isPending) {
      loadData();
    }
  }, [sessionUser, isPending]);

  const currentUser = sessionUser ? {
    id: sessionUser.id,
    email: sessionUser.email,
    username: sessionUser.name,
    avatar: sessionUser.image || undefined,
  } : null;

  if (isPending || loading) {
    return (
      <div className="container mx-auto px-4 pt-24 pb-16 flex items-center justify-center min-h-[400px]">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
          <div className="absolute inset-0 rounded-full border-2 border-t-primary animate-spin" />
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="container mx-auto px-4 pt-24 pb-16 max-w-xl">
        <EmptyState
          title="Non connecté"
          description="Connectez-vous pour accéder et synchroniser votre bibliothèque de favoris, liste de lecture et historique."
          action={{ label: "Retour à l'accueil", href: '/' }}
        />
      </div>
    );
  }

  // Convertir le type local en type Media pour MediaCard
  const mapToMedia = (item: any): Media => ({
    id: item.id || item.mediaId,
    type: item.type as any,
    title: item.title,
    slug: item.slug,
    posterUrl: item.posterUrl || '',
    rating: typeof item.rating === 'string' ? parseFloat(item.rating) : (item.rating || 0),
    year: typeof item.year === 'string' ? parseInt(item.year, 10) : (item.year || 0),
    createdAt: '',
    updatedAt: ''
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-8 pb-16 animate-fade-in-up">
      {/* Profil Header Card */}
      <div className="relative mb-10 overflow-hidden rounded-3xl bg-secondary/35 border border-border/40 shadow-2xl">
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-primary/15 via-purple-500/5 to-transparent" />
        <div className="h-32 sm:h-40 w-full bg-gradient-to-r from-primary/20 via-blue-600/10 to-transparent" />
        
        <div className="relative px-6 pb-6 pt-0 flex flex-col md:flex-row md:items-end justify-between gap-6 -mt-10 sm:-mt-14">
          <div className="flex flex-col sm:flex-row items-center sm:items-end gap-5 text-center sm:text-left">
            <div className="h-24 w-24 sm:h-28 sm:w-28 rounded-full border-4 border-background overflow-hidden bg-card shadow-xl shrink-0 group-hover:scale-105 transition-all">
              <img
                src={currentUser.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${currentUser.email}`}
                alt={currentUser.username}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="mb-2">
              <h1 className="text-2xl sm:text-3xl font-display font-bold text-white flex items-center justify-center sm:justify-start gap-2">
                {currentUser.username}
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30 tracking-wider">
                  Membre
                </span>
              </h1>
              <p className="text-[13px] text-muted-foreground mt-0.5">{currentUser.email}</p>
            </div>
          </div>
          
          <div className="flex items-center justify-center gap-3 shrink-0">
            <a
              href="/settings"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium border border-border hover:bg-white/[0.04] text-foreground transition-all duration-200"
            >
              <Settings className="w-4 h-4 text-muted-foreground" />
              Réglages
            </a>
            <button
              onClick={async () => {
                await authClient.signOut();
                window.location.href = '/';
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold bg-red-950/20 text-red-400 hover:bg-red-950/40 border border-red-500/20 transition-all duration-200"
            >
              <LogOut className="w-4 h-4" />
              Déconnexion
            </button>
          </div>
        </div>
      </div>

      {/* Compteurs / Stats */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-8">
        <button
          onClick={() => setActiveTab('favorites')}
          className={`flex flex-col items-center justify-center p-4 sm:p-5 rounded-2xl border transition-all ${
            activeTab === 'favorites'
              ? 'bg-primary/10 border-primary/30 text-primary shadow-[0_4px_16px_rgba(59,130,246,0.1)]'
              : 'bg-secondary/20 border-border/40 hover:bg-secondary/40 text-muted-foreground hover:text-foreground'
          }`}
        >
          <Heart className="h-5 w-5 mb-1.5 fill-current" />
          <span className="text-xl sm:text-2xl font-display font-bold text-foreground">{favorites.length}</span>
          <span className="text-[10px] sm:text-xs uppercase tracking-wider font-semibold mt-0.5">Favoris</span>
        </button>

        <button
          onClick={() => setActiveTab('watchlist')}
          className={`flex flex-col items-center justify-center p-4 sm:p-5 rounded-2xl border transition-all ${
            activeTab === 'watchlist'
              ? 'bg-purple-500/10 border-purple-500/30 text-purple-400 shadow-[0_4px_16px_rgba(168,85,247,0.1)]'
              : 'bg-secondary/20 border-border/40 hover:bg-secondary/40 text-muted-foreground hover:text-foreground'
          }`}
        >
          <Clock className="h-5 w-5 mb-1.5" />
          <span className="text-xl sm:text-2xl font-display font-bold text-foreground">{watchlist.length}</span>
          <span className="text-[10px] sm:text-xs uppercase tracking-wider font-semibold mt-0.5">À voir</span>
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`flex flex-col items-center justify-center p-4 sm:p-5 rounded-2xl border transition-all ${
            activeTab === 'history'
              ? 'bg-teal-500/10 border-teal-500/30 text-teal-400 shadow-[0_4px_16px_rgba(20,184,166,0.1)]'
              : 'bg-secondary/20 border-border/40 hover:bg-secondary/40 text-muted-foreground hover:text-foreground'
          }`}
        >
          <History className="h-5 w-5 mb-1.5" />
          <span className="text-xl sm:text-2xl font-display font-bold text-foreground">{history.length}</span>
          <span className="text-[10px] sm:text-xs uppercase tracking-wider font-semibold mt-0.5">Historique</span>
        </button>
      </div>

      {/* Main Grid Content Column */}
      <div className="bg-secondary/15 border border-border/40 rounded-3xl p-5 sm:p-7">
        
        {/* Contenu de l'onglet favoris */}
        {activeTab === 'favorites' && (
          <div>
            <div className="flex items-center gap-2 mb-6">
              <Heart className="w-5 h-5 text-primary fill-current" />
              <h2 className="text-lg font-display font-semibold text-foreground">Mes Favoris</h2>
            </div>
            
            {favorites.length === 0 ? (
              <div className="py-12">
                <EmptyState
                  title="Aucun favori"
                  description="Cliquez sur le bouton favoris de n'importe quel média pour l'ajouter ici."
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4">
                {favorites.map(item => (
                  <MediaCard key={item.id} media={mapToMedia(item)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Contenu de l'onglet watchlist */}
        {activeTab === 'watchlist' && (
          <div>
            <div className="flex items-center gap-2 mb-6">
              <Clock className="w-5 h-5 text-purple-400" />
              <h2 className="text-lg font-display font-semibold text-foreground">Ma Watchlist (À voir)</h2>
            </div>
            
            {watchlist.length === 0 ? (
              <div className="py-12">
                <EmptyState
                  title="Watchlist vide"
                  description="Ajoutez des séries ou des films à votre plan de lecture."
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4">
                {watchlist.map(item => (
                  <MediaCard key={item.id} media={mapToMedia(item)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Contenu de l'onglet historique */}
        {activeTab === 'history' && (
          <div>
            <div className="flex items-center gap-2 mb-6">
              <History className="w-5 h-5 text-teal-400" />
              <h2 className="text-lg font-display font-semibold text-foreground">Historique récent</h2>
            </div>
            
            {history.length === 0 ? (
              <div className="py-12">
                <EmptyState
                  title="Aucune activité"
                  description="Parcourez des fiches médias pour commencer à accumuler votre historique."
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4">
                {history.map(item => (
                  <MediaCard key={item.mediaId} media={mapToMedia(item)} />
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
