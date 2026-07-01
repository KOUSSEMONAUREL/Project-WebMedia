import { MediaCard } from './MediaCard';
import type { Media } from '@/lib/api';
import { ChevronRight } from 'lucide-react';

interface MediaGridProps {
  title: string;
  items: Media[];
  viewAllHref?: string;
}

export function MediaGrid({ title, items, viewAllHref }: MediaGridProps) {
  return (
    <section className="py-6">
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[18px] md:text-[20px] font-display font-bold text-foreground tracking-tight">
          {title}
        </h2>
        {viewAllHref && (
          <a
            href={viewAllHref}
            className="flex items-center gap-1 text-[12px] font-semibold text-muted-foreground hover:text-primary transition-colors group"
          >
            Voir tout
            <ChevronRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
          </a>
        )}
      </div>

      {items.length > 0 ? (
        <div className="poster-row">
          {items.map((media) => (
            <MediaCard key={media.id} media={media} />
          ))}
        </div>
      ) : (
        <div className="py-14 text-center rounded-xl border border-border/30 bg-white/[0.015]">
          <p className="text-muted-foreground text-sm">Aucun contenu trouvé.</p>
        </div>
      )}
    </section>
  );
}
