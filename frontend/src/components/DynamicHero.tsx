import { ChevronRight } from 'lucide-react';

export function DynamicHero() {
  return (
    <section className="relative overflow-hidden pt-12 pb-2 md:pt-16 md:pb-2">
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 50% -10%, rgba(59,130,246,0.08) 0%, transparent 70%)',
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 flex flex-col items-center text-center">
        <h1 className="font-display font-bold leading-[1.1] tracking-tight text-white max-w-3xl
          text-3xl sm:text-4xl md:text-[52px]">
          Tout le divertissement,{' '}
          <span
            style={{
              background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 45%, #2563eb 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            un seul endroit.
          </span>
        </h1>

        <p className="mt-2 text-muted-foreground max-w-md text-[14px] leading-relaxed">
          Films, séries, animés, jeux, webtoons, livres et light novels.
        </p>
      </div>
    </section>
  );
}
