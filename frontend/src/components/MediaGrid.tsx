import { useId } from 'react';
import { MediaCard } from './MediaCard';
import { useScrollAnimation } from '@/lib/useScrollAnimation';
import type { Media } from '@/lib/api';
import { ChevronRight } from 'lucide-react';

const sectionAccents: Record<string, { glow: string; from: string; via: string; border: string }> = {
  film:    { glow: 'rgba(59,130,246,0.15)', from: 'rgba(59,130,246,0.04)', via: 'transparent',  border: 'rgba(59,130,246,0.15)' },
  serie:   { glow: 'rgba(139,92,246,0.15)', from: 'rgba(139,92,246,0.04)', via: 'transparent', border: 'rgba(139,92,246,0.15)' },
  anime:   { glow: 'rgba(244,63,94,0.15)', from: 'rgba(244,63,94,0.04)', via: 'transparent',  border: 'rgba(244,63,94,0.15)' },
  jeu:     { glow: 'rgba(16,185,129,0.15)', from: 'rgba(16,185,129,0.04)', via: 'transparent', border: 'rgba(16,185,129,0.15)' },
  webtoon: { glow: 'rgba(245,158,11,0.15)', from: 'rgba(245,158,11,0.04)', via: 'transparent', border: 'rgba(245,158,11,0.15)' },
  book:    { glow: 'rgba(249,115,22,0.15)', from: 'rgba(249,115,22,0.04)', via: 'transparent', border: 'rgba(249,115,22,0.15)' },
  novel:   { glow: 'rgba(20,184,166,0.15)', from: 'rgba(20,184,166,0.04)', via: 'transparent', border: 'rgba(20,184,166,0.15)' },
};

const sectionHeaderColors: Record<string, string> = {
  film:    'text-sky-400',
  serie:   'text-violet-400',
  anime:   'text-rose-400',
  jeu:     'text-emerald-400',
  webtoon: 'text-amber-400',
  book:    'text-orange-400',
  novel:   'text-teal-400',
};

const sectionLinkColors: Record<string, string> = {
  film:    'hover:text-sky-400',
  serie:   'hover:text-violet-400',
  anime:   'hover:text-rose-400',
  jeu:     'hover:text-emerald-400',
  webtoon: 'hover:text-amber-400',
  book:    'hover:text-orange-400',
  novel:   'hover:text-teal-400',
};

interface MediaGridProps {
  title: string;
  items: Media[];
  viewAllHref?: string;
  minCards?: number;
  size?: 'normal' | 'large';
  mediaType?: string;
}

export function MediaGrid({ title, items, viewAllHref, minCards, size = 'normal', mediaType }: MediaGridProps) {
  const placeholders = minCards ? Math.max(0, minCards - items.length) : 0;
  const isLarge = size === 'large';
  const id = useId();

  const accent = mediaType ? sectionAccents[mediaType] : null;
  const headerColor = mediaType ? sectionHeaderColors[mediaType] : 'text-foreground';
  const linkColor = mediaType ? sectionLinkColors[mediaType] : 'hover:text-primary';

  const { ref, isVisible } = useScrollAnimation<HTMLElement>({ threshold: 0.02 });

  return (
    <section
      ref={ref}
      className={`relative py-6 sm:py-8 lg:py-10 transition-all duration-700 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
      }`}
    >
      {accent && (
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none -mx-2 sm:-mx-4 px-2 sm:px-4"
          aria-hidden="true"
          style={{
            background: `linear-gradient(180deg, ${accent.from} 0%, ${accent.via} 60%, transparent 100%)`,
            borderLeft: `1px solid ${accent.border}`,
            borderRight: `1px solid ${accent.border}`,
          }}
        >
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-px"
            style={{
              background: `linear-gradient(90deg, transparent 0%, ${accent.glow} 50%, transparent 100%)`,
            }}
          />
        </div>
      )}

      <div className="flex items-center justify-between mb-3 relative">
        <div className="flex items-center gap-2.5">
          {accent && (
            <span
              className="w-1 h-5 rounded-full shrink-0"
              style={{ background: `linear-gradient(180deg, ${accent.glow.replace('0.15','0.6')}, ${accent.glow.replace('0.15','0.15')})` }}
            />
          )}
          <h2 className={`text-[16px] md:text-[18px] font-display font-bold tracking-tight ${headerColor}`}>
            {title}
          </h2>
        </div>
        {viewAllHref && (
          <a
            href={viewAllHref}
            className={`flex items-center gap-1 text-[11px] font-semibold text-muted-foreground transition-colors group ${linkColor}`}
          >
            Voir tout
            <ChevronRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
          </a>
        )}
      </div>

      <div className="poster-row">
        {items.map((media, i) => (
          <MediaCard
            key={media.id}
            media={media}
            size={size}
            isLcp={i === 0 && title === 'Recommandations'}
            animationDelay={i * 0.06}
          />
        ))}
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
