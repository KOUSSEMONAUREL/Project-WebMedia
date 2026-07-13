import { useState, useEffect } from 'react';
import { MediaCard } from './MediaCard';
import { allMockData } from '../lib/api';
import type { Media } from '../lib/api';
import { useCachedSession } from '@/lib/auth-client';
import { EmptyState } from './EmptyState';

interface ListPageProps {
  storageKey: string;
  title: string;
  description: string;
  emptyIcon: string;
  emptyTitle: string;
  emptyDescription: string;
}

export function ListPage({ storageKey, title, description, emptyIcon, emptyTitle, emptyDescription }: ListPageProps) {
  const [items, setItems] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);

  const { data: session } = useCachedSession();
  const user = session?.user ?? null;

  useEffect(() => {
    if (user) {
      const stored = localStorage.getItem(storageKey);
      const ids: string[] = stored ? JSON.parse(stored) : [];
      const mediaMap: Record<string, Media> = {};
      for (const m of allMockData) mediaMap[m.id] = m;
      setItems(ids.map(id => mediaMap[id]).filter(Boolean));
    }
    setLoading(false);
  }, [storageKey]);

  return (
    <div className="container mx-auto px-6 pt-16 pb-16">
      <header className="mb-8 text-center animate-fade-in">
        <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground">{title}</h1>
        <p className="text-muted-foreground mt-1">{description}</p>
        <div className="w-16 h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent mx-auto mt-4" />
      </header>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !user ? (
        <EmptyState
          title="Connectez-vous"
          description="Connectez-vous pour gérer votre liste."
          action={{ label: "Retour à l'accueil", href: '/' }}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={emptyIcon}
          title={emptyTitle}
          description={emptyDescription}
          action={{ label: 'Découvrir du contenu', href: '/trending' }}
        />
      ) : (
        <div className="animate-fade-in">
          <p className="text-sm text-muted-foreground mb-6">{items.length} élément{items.length > 1 ? 's' : ''}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 stagger-children">
            {items.map(media => (
              <MediaCard key={media.id} media={media} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
