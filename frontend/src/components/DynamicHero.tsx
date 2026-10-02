import { ChevronRight } from 'lucide-react';
import { useT } from '@/lib/translate-init';

export function DynamicHero() {
  const full = useT('Tout le divertissement, un seul endroit.');
  const cut = full.indexOf(',');
  const heroA = cut > 0 ? full.slice(0, cut + 1) : full;
  const heroB = cut > 0 ? full.slice(cut + 1).trim() : '';
  return (
    <section className="relative overflow-hidden pt-8 pb-2 sm:pt-12 md:pt-16 md:pb-2 w-full">
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
          text-2xl xs:text-3xl sm:text-4xl md:text-[52px]">
          {heroA}{' '}
          <span
            style={{
              background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 45%, #2563eb 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {heroB}
          </span>
        </h1>
      </div>
    </section>
  );
}
