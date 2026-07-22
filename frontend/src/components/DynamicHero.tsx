export function DynamicHero() {
  return (
    <section className="relative overflow-hidden pt-12 pb-6 sm:pt-20 sm:pb-10 w-full">
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-primary/5 rounded-full blur-[140px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 flex flex-col items-center text-center">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[11px] font-semibold mb-5 sm:mb-7 backdrop-blur-sm animate-fade-in-up">
          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
          10 000+ titres references
        </div>

        <h1 className="font-display font-bold leading-[1.1] tracking-tight text-white max-w-4xl
          text-3xl sm:text-4xl md:text-[56px] lg:text-[64px]">
          Tout le divertissement,{' '}
          <span className="bg-gradient-to-r from-blue-400 via-primary to-blue-500 bg-clip-text text-transparent">
            un seul endroit.
          </span>
        </h1>

        <p className="mt-4 sm:mt-5 text-[14px] sm:text-[16px] text-muted-foreground max-w-xl leading-relaxed">
          Films, series, animes, mangas, jeux video, livres et light novels.
          Accede aux meilleurs contenus depuis un seul annuaire, sans inscription.
        </p>

        <div className="flex items-center gap-3 mt-6 sm:mt-8">
          <a
            href="/trending"
            className="inline-flex items-center gap-2 font-semibold text-[13px] sm:text-[14px] px-5 py-2.5 rounded-full text-primary-foreground shadow-lg transition-all duration-200 hover:scale-[1.04] active:scale-[0.97]"
            style={{
              background: 'linear-gradient(135deg,#60a5fa 0%,#3b82f6 60%,#2563eb 100%)',
              boxShadow: '0 4px 24px rgba(59,130,246,0.3),0 1px 4px rgba(0,0,0,0.3)',
            }}
          >
            Explorer les tendances
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" className="h-4 w-4">
              <path fillRule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708"/>
            </svg>
          </a>
          <a
            href="/genres"
            className="inline-flex items-center gap-2 font-medium text-[13px] sm:text-[14px] px-5 py-2.5 rounded-full text-foreground border border-border/60 bg-white/[0.04] hover:bg-white/[0.07] hover:border-primary/30 transition-all duration-200"
          >
            Parcourir par genre
          </a>
        </div>
      </div>
    </section>
  );
}
