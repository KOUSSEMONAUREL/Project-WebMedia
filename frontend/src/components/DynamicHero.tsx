import { ChevronRight } from 'lucide-react';

export function DynamicHero() {
  return (
    <section className="relative overflow-hidden pt-8 pb-6 sm:pt-16 md:pt-20 md:pb-10 w-full">
      {/* Animated gradient blobs */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-primary/8 rounded-full blur-[120px] animate-glow-pulse" />
        <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] bg-accent/6 rounded-full blur-[140px] animate-glow-pulse" style={{ animationDelay: '1.5s' }} />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/4 rounded-full blur-[100px]" />
      </div>

      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.015]"
        aria-hidden="true"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      {/* Floating decorative dots */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute top-16 left-[10%] w-2 h-2 bg-primary/40 rounded-full animate-ping" style={{ animationDuration: '3s' }} />
        <div className="absolute top-8 right-[15%] w-1.5 h-1.5 bg-accent/30 rounded-full animate-ping" style={{ animationDuration: '4s', animationDelay: '1s' }} />
        <div className="absolute bottom-20 left-[25%] w-2.5 h-2.5 bg-primary/20 rounded-full animate-ping" style={{ animationDuration: '5s', animationDelay: '2s' }} />
        <div className="absolute top-1/2 right-[8%] w-1 h-1 bg-accent/25 rounded-full animate-ping" style={{ animationDuration: '3.5s', animationDelay: '0.5s' }} />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 flex flex-col items-center text-center">
        {/* Badge live */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[11px] font-semibold mb-4 sm:mb-6 backdrop-blur-sm animate-fade-in-up">
          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
          10 000+ titres references
        </div>

        <h1 className="font-display font-bold leading-[1.1] tracking-tight text-white max-w-4xl animate-fade-in-up
          text-2xl xs:text-3xl sm:text-4xl md:text-[56px] lg:text-[64px]"
          style={{ animationDelay: '0.1s' }}
        >
          Tout le divertissement,{' '}
          <span
            className="bg-gradient-to-r from-blue-400 via-primary to-blue-500 bg-clip-text text-transparent animate-gradient"
          >
            un seul endroit.
          </span>
        </h1>

        <p
          className="mt-4 sm:mt-5 text-[14px] sm:text-[16px] text-muted-foreground max-w-xl leading-relaxed animate-fade-in-up"
          style={{ animationDelay: '0.2s' }}
        >
          Films, series, animes, mangas, jeux video, livres et light novels.
          Accede aux meilleurs contenus depuis un seul annuaire, sans inscription.
        </p>

        {/* CTA buttons */}
        <div
          className="flex items-center gap-3 mt-6 sm:mt-8 animate-fade-in-up"
          style={{ animationDelay: '0.3s' }}
        >
          <a
            href="/trending"
            className="inline-flex items-center gap-2 font-semibold text-[13px] sm:text-[14px] px-5 py-2.5 rounded-full text-primary-foreground shadow-lg transition-all duration-200 hover:scale-[1.04] active:scale-[0.97]"
            style={{
              background: 'linear-gradient(135deg,#60a5fa 0%,#3b82f6 60%,#2563eb 100%)',
              boxShadow: '0 4px 24px rgba(59,130,246,0.3),0 1px 4px rgba(0,0,0,0.3)',
            }}
          >
            Explorer les tendances
            <ChevronRight className="h-4 w-4" />
          </a>
          <a
            href="/genres"
            className="inline-flex items-center gap-2 font-medium text-[13px] sm:text-[14px] px-5 py-2.5 rounded-full text-foreground border border-border/60 bg-white/[0.04] hover:bg-white/[0.07] hover:border-primary/30 transition-all duration-200"
          >
            Parcourir par genre
          </a>
        </div>

        {/* Stats row */}
        <div
          className="flex flex-wrap items-center justify-center gap-8 sm:gap-12 mt-10 sm:mt-12 pt-6 sm:pt-8 border-t border-border/30 w-full max-w-lg animate-fade-in-up"
          style={{ animationDelay: '0.4s' }}
        >
          <div className="flex flex-col items-center gap-1">
            <span
              className="text-xl sm:text-2xl font-display font-bold"
              style={{
                background: 'linear-gradient(135deg,#60a5fa 0%,#3b82f6 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              10 000+
            </span>
            <span className="text-[10px] text-muted-foreground font-semibold tracking-wider uppercase">Titres</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span
              className="text-xl sm:text-2xl font-display font-bold"
              style={{
                background: 'linear-gradient(135deg,#60a5fa 0%,#3b82f6 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              8
            </span>
            <span className="text-[10px] text-muted-foreground font-semibold tracking-wider uppercase">Categories</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span
              className="text-xl sm:text-2xl font-display font-bold"
              style={{
                background: 'linear-gradient(135deg,#60a5fa 0%,#3b82f6 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Gratuit
            </span>
            <span className="text-[10px] text-muted-foreground font-semibold tracking-wider uppercase">Acces</span>
          </div>
        </div>
      </div>
    </section>
  );
}
