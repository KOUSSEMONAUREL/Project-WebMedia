import { MediaCard } from './MediaCard';
import type { Media } from '@/lib/api';
import { ChevronRight } from 'lucide-react';

interface MediaGridProps {
  title: string;
  items: Media[];
  viewAllHref?: string;
  minCards?: number;
  size?: 'normal' | 'large';
}

export function MediaGrid({ title, items, viewAllHref, minCards, size = 'normal' }: MediaGridProps) {
  const placeholders = minCards ? Math.max(0, minCards - items.length) : 0;
  const isLarge = size === 'large';

  return (
    <section className="py-10">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[16px] md:text-[18px] font-display font-bold text-foreground tracking-tight">
          {title}
        </h2>
        {viewAllHref && (
          <a
            href={viewAllHref}
            className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-primary transition-colors group"
          >
            Voir tout
            <ChevronRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
          </a>
        )}
      </div>

      <div className="poster-row">
        {items.map((media) => <MediaCard key={media.id} media={media} size={size} />)}
        {Array.from({ length: placeholders }).map((_, i) => (
          <div key={`ph-${i}`} className={`flex-shrink-0 poster-row-card ${
            isLarge ? 'w-[180px] sm:w-[212px]' : 'w-[164px] sm:w-[192px]'
          }`}>
            <div className="aspect-[2/3] w-full rounded-xl bg-secondary/50 border border-border/20" />
            <div className="mt-2 h-3 w-24 rounded bg-secondary/40" />
            <div className="mt-1 h-2.5 w-16 rounded bg-secondary/30" />
          </div>
        ))}
        {items.length === 0 && !minCards && (
          <div className="py-10 text-center w-full">
            <p className="text-muted-foreground text-sm">Aucun contenu trouvé.</p>
          </div>
        )}
      </div>
    </section>
  );
}
