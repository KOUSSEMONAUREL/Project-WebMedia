import { useState, useEffect } from 'react';
import { hoverStore } from '../stores/hover';
import type { Media } from '../lib/api';

const typeColors: Record<string, string> = {
  film: 'from-blue-600/40',
  serie: 'from-purple-600/40',
  anime: 'from-orange-500/40',
  jeu: 'from-green-600/40',
  webtoon: 'from-orange-600/40',
  book: 'from-amber-600/40',
  novel: 'from-teal-600/40',
};

const typeLabels: Record<string, string> = {
  film: 'Film', serie: 'Série', anime: 'Animé',
  jeu: 'Jeu Vidéo', webtoon: 'Webtoon', book: 'Livre', novel: 'Light Novel',
};

interface DynamicHeroProps {
  defaultTitle?: string;
  defaultSubtitle?: string;
}

export function DynamicHero({ defaultTitle, defaultSubtitle }: DynamicHeroProps = {}) {
  const [prevHovered, setPrevHovered] = useState<Media | null>(null);
  const [showing, setShowing] = useState<'default' | 'media'>('default');

  useEffect(() => {
    const unsub = hoverStore.subscribe(() => {
      const m = hoverStore.media;
      if (m) {
        setPrevHovered(m);
        setShowing('media');
      } else {
        setShowing('default');
      }
    });
    return unsub;
  }, []);

  return (
    <div className="relative h-[50vh] min-h-[320px] md:min-h-[400px] overflow-hidden rounded-2xl mb-12">
      {/* Default state */}
      <div
        className={`absolute inset-0 transition-opacity duration-500 ease-in-out ${
          showing === 'default' ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-background" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(212,175,55,0.08),transparent_70%)]" />
        <div className="relative z-10 flex flex-col items-center justify-center h-full text-center px-6">
          <div className="w-16 h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent mb-6" />
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-display font-semibold text-white leading-tight whitespace-nowrap">
            {defaultTitle ? defaultTitle : <>Tout le divertissement, <span className="text-primary italic">un seul endroit.</span></>}
          </h1>
          <p className="text-muted-foreground max-w-lg mt-4">
            {defaultSubtitle ? defaultSubtitle : 'Films, séries, animés, jeux, livres & light novels — votre bibliothèque ultime.'}
          </p>
          <div className="w-16 h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent mt-6" />
        </div>
      </div>

      {/* Media hover state */}
      <div
        className={`absolute inset-0 transition-opacity duration-500 ease-in-out ${
          showing === 'media' ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {prevHovered && (
          <>
            {/* Backdrop */}
            <div className="absolute inset-0">
              <img
                src={prevHovered.backdropUrl || prevHovered.posterUrl}
                alt=""
                className="h-full w-full object-cover"
              />
              <div className={`absolute inset-0 bg-gradient-to-r ${typeColors[prevHovered.type] || 'from-primary/40'} via-background/95 to-background`} />
            </div>

            <div className="relative z-10 h-full flex items-center px-6 md:px-12">
              <div className="flex items-center gap-6 md:gap-10">
                {/* Poster */}
                <div className="hidden sm:block w-28 md:w-36 shrink-0 rounded-xl overflow-hidden shadow-2xl border border-white/10 rotate-[2deg] hover:rotate-0 transition-transform duration-500">
                  <img
                    src={prevHovered.posterUrl}
                    alt={prevHovered.title}
                    className="w-full aspect-[2/3] object-cover"
                  />
                </div>

                {/* Info */}
                <div className="max-w-2xl">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="px-3 py-1 rounded-full bg-white/10 backdrop-blur border border-white/10 text-xs font-semibold text-white uppercase tracking-wider">
                      {typeLabels[prevHovered.type] || prevHovered.type}
                    </span>
                    {prevHovered.year && (
                      <span className="text-sm text-muted-foreground">{prevHovered.year}</span>
                    )}
                    {prevHovered.rating && (
                      <span className="flex items-center gap-1 text-sm text-yellow-500">
                        <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                        {prevHovered.rating}
                      </span>
                    )}
                  </div>
                  <h2 className="text-3xl md:text-4xl lg:text-5xl font-display font-bold text-white leading-tight mb-3">
                    {prevHovered.title}
                  </h2>
                  {prevHovered.synopsis && (
                    <p className="text-muted-foreground text-sm md:text-base line-clamp-3 leading-relaxed max-w-xl">
                      {prevHovered.synopsis}
                    </p>
                  )}
                  {prevHovered.genres && prevHovered.genres.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4">
                      {prevHovered.genres.slice(0, 4).map(g => (
                        <span key={g} className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-muted-foreground">
                          {g}
                        </span>
                      ))}
                    </div>
                  )}
                  <a
                    href={`/${prevHovered.type}/${prevHovered.slug}`}
                    className="inline-flex items-center gap-2 mt-6 bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2.5 rounded-full font-semibold text-sm transition-all hover:scale-105"
                  >
                    Voir les détails
                  </a>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
