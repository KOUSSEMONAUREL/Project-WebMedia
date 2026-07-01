import { ChevronRight } from 'lucide-react';

export function DynamicHero() {
  return (
    <section className="relative overflow-hidden pt-16 pb-14 md:pt-20 md:pb-16">
      {/* Ambient background glows – very subtle */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 50% -10%, rgba(232,184,37,0.08) 0%, transparent 70%)',
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 flex flex-col items-center text-center">
        {/* Headline */}
        <h1 className="font-display font-bold leading-[1.1] tracking-tight text-white max-w-3xl
          text-3xl sm:text-4xl md:text-[52px]">
          Tout le divertissement,{' '}
          <span
            style={{
              background: 'linear-gradient(135deg, #f5d060 0%, #e8b825 45%, #c99a14 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            un seul endroit.
          </span>
        </h1>

        {/* Subtitle */}
        <p className="mt-4 text-muted-foreground max-w-md text-[15px] leading-relaxed">
          Films, séries, animés, jeux, webtoons, livres et light novels.
        </p>

        {/* CTAs */}
        <div className="flex items-center gap-3 mt-8 flex-wrap justify-center">
          <a
            href="/trending"
            className="inline-flex items-center gap-2 font-semibold text-[14px] px-6 py-2.5 rounded-full text-primary-foreground shadow-lg transition-all duration-200 hover:scale-[1.03] active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, #f0c040 0%, #e8b825 60%, #c99a14 100%)',
              boxShadow: '0 4px 24px rgba(232,184,37,0.3), 0 1px 4px rgba(0,0,0,0.3)',
            }}
          >
            Explorer les tendances
            <ChevronRight className="h-4 w-4" />
          </a>
          <a
            href="/genres"
            className="inline-flex items-center gap-2 font-medium text-[14px] px-6 py-2.5 rounded-full text-foreground border border-border/60 bg-white/[0.04] hover:bg-white/[0.07] hover:border-primary/30 transition-all duration-200"
          >
            Parcourir par genre
          </a>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-6 sm:gap-10 mt-10 text-center">
          {[
            { value: '10 000+', label: 'Titres' },
            { value: '8',       label: 'Catégories' },
            { value: 'Gratuit', label: 'Accès' },
          ].map((stat) => (
            <div key={stat.label} className="flex flex-col">
              <span
                className="text-2xl font-display font-bold"
                style={{
                  background: 'linear-gradient(135deg, #f0c040 0%, #e8b825 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                {stat.value}
              </span>
              <span className="text-[12px] text-muted-foreground mt-0.5 font-medium">
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
