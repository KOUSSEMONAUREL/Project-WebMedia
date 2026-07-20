import { useState, useEffect } from 'react';
import { authClient, getAuthToken, useCachedSession, clearUserCache } from '@/lib/auth-client';
import { Heart, Clock, History } from 'lucide-react';
import { getAllFavorites, getWatchlist, getHistory } from '../lib/indexeddb';
import type { Favorite, HistoryEntry } from '../lib/indexeddb';
import type { Media } from '../lib/api';
import { EmptyState } from './EmptyState';
import { ProfileHeader } from './ProfileHeader';
import { MediaGridTab } from './MediaGridTab';

function handleLogout() {
  clearUserCache();
  authClient.signOut();
  window.location.href = '/';
}

function mapToMedia(item: any): Media {
  return {
    id: item.id || item.mediaId,
    type: item.type as any,
    title: item.title,
    slug: item.slug,
    posterUrl: item.posterUrl || '',
    rating: typeof item.rating === 'string' ? parseFloat(item.rating) : (item.rating || 0),
    year: typeof item.year === 'string' ? parseInt(item.year, 10) : (item.year || 0),
    createdAt: '',
    updatedAt: '',
  };
}

type TabType = 'favorites' | 'watchlist' | 'history';

export function UserProfile({ initialTab = 'favorites' }: { initialTab?: TabType }) {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [watchlist, setWatchlist] = useState<Favorite[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const { data: session, isPending } = useCachedSession();
  const sessionUser = session?.user;

  const loadData = async (signal?: AbortSignal) => {
    try {
      let localFavs = await getAllFavorites();

      if (sessionUser) {
        try {
          const token = await getAuthToken();

          const apiBaseUrl = import.meta.env.PUBLIC_API_URL || 'http://localhost:8787/api';
          const headers: Record<string, string> = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;

          const res = await fetch(`${apiBaseUrl}/user/favorites`, {
            headers,
            credentials: 'include',
            signal,
          });
          if (res.ok) {
            const json = await res.json();
            if (json.success && Array.isArray(json.data)) {
              const remoteIds: string[] = json.data.map((f: any) => f.mediaId);
              const localIds = localFavs.map(f => f.id);
              const localIdSet = new Set(localIds);
              const missingIds = remoteIds.filter(id => !localIdSet.has(id));

              if (missingIds.length > 0) {
                const { getMediaDetails } = await import('../lib/api');
                const { addFavorite } = await import('../lib/indexeddb');

                await Promise.all(missingIds.map(async (id) => {
                  try {
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
                    await addFavorite({
                      id,
                      type: 'film',
                      title: 'Media de ma bibliotheque',
                      slug: id
                    });
                  }
                }));
                localFavs = await getAllFavorites();
              }
            }
          }
        } catch (syncErr) {
          console.warn('[sync-profile] Echec de la recuperation des favoris Supabase:', syncErr);
        }

        const adminToken = await getAuthToken();
        if (adminToken) {
          try {
            const adminUrl = (import.meta.env.PUBLIC_API_URL || 'http://localhost:8787').replace(/\/+$/, '') + '/api';
            const adminRes = await fetch(`${adminUrl}/admin/check`, {
              headers: { 'Authorization': `Bearer ${adminToken}` },
              credentials: 'include',
              signal,
            });
            if (adminRes.ok) setIsAdmin(true);
          } catch {}
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
    if (isPending) return;
    const ac = new AbortController();
    loadData(ac.signal);
    return () => ac.abort();
  }, [sessionUser, isPending]); // eslint-disable-line react-hooks/exhaustive-deps

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
          title="Non connecte"
          description="Connectez-vous pour acceder et synchroniser votre bibliotheque de favoris, liste de lecture et historique."
          action={{ label: "Retour a l'accueil", href: '/' }}
        />
      </div>
    );
  }

  const tabContent = () => {
    switch (activeTab) {
      case 'favorites':
        return (
          <MediaGridTab
            icon={<Heart className="w-5 h-5 text-primary fill-current" />}
            title="Mes Favoris"
            items={favorites.map(f => ({ id: f.id, media: mapToMedia(f) }))}
            emptyTitle="Aucun favori"
            emptyDescription="Cliquez sur le bouton favoris de n'importe quel media pour l'ajouter ici."
          />
        );
      case 'watchlist':
        return (
          <MediaGridTab
            icon={<Clock className="w-5 h-5 text-purple-400" />}
            title="Ma Watchlist (A voir)"
            items={watchlist.map(f => ({ id: f.id, media: mapToMedia(f) }))}
            emptyTitle="Watchlist vide"
            emptyDescription="Ajoutez des series ou des films a votre plan de lecture."
          />
        );
      case 'history':
        return (
          <MediaGridTab
            icon={<History className="w-5 h-5 text-teal-400" />}
            title="Historique recent"
            items={history.map(f => ({ id: f.mediaId, media: mapToMedia(f) }))}
            emptyTitle="Aucune activite"
            emptyDescription="Parcourez des fiches medias pour commencer a accumuler votre historique."
          />
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-8 pb-16 animate-fade-in-up">
      <ProfileHeader
        username={currentUser.username}
        email={currentUser.email}
        avatar={currentUser.avatar}
        activeTab={activeTab}
        favCount={favorites.length}
        wlCount={watchlist.length}
        histCount={history.length}
        isAdmin={isAdmin}
        onTabChange={setActiveTab}
        onLogout={handleLogout}
      />

      <div className="bg-secondary/15 border border-border/40 rounded-3xl p-5 sm:p-7">
        {tabContent()}
      </div>
    </div>
  );
}
