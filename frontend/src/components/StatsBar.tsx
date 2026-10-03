import { useEffect, useRef, useState } from 'react';
import { getMediaStats, type MediaStats } from '@/lib/api';

const CATEGORIES: { type: string; label: string; href: string }[] = [
  { type: 'film', label: 'Films', href: '/films' },
  { type: 'serie', label: 'Series', href: '/series' },
  { type: 'anime', label: 'Animes', href: '/animes' },
  { type: 'jeu', label: 'Games', href: '/games' },
  { type: 'book', label: 'Books', href: '/books' },
  { type: 'novel', label: 'Light Novels', href: '/novels' },
  { type: 'comic', label: 'Comics', href: '/comics' },
  { type: 'webtoon', label: 'Webtoons', href: '/webtoons' },
];

const GRADIENT = 'linear-gradient(135deg,#60a5fa 0%,#3b82f6 100%)';

function format(n: number): string {
  return n.toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ');
}

function useCountUp(target: number, active: boolean): number {
  const [value, setValue] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!active || !Number.isFinite(target) || target <= 0) {
      setValue(target > 0 ? target : 0);
      return;
    }
    const duration = 1100;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [target, active]);

  return value;
}

export function StatsBar() {
  const [stats, setStats] = useState<MediaStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getMediaStats().then((s) => {
      if (!alive) return;
      if (s) setStats(s);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const ready = !!stats;
  const total = useCountUp(stats?.total ?? 0, ready);
  const hasBreakdown = ready && CATEGORIES.some((c) => (stats?.byType?.[c.type] ?? 0) > 0);

  if (failed) return null;

  return (
    <div className="flex flex-wrap items-start justify-center gap-x-8 gap-y-5 sm:gap-x-12 sm:gap-y-6 text-center">
      <div className="group relative flex flex-col items-center gap-1">
        <span
          className="text-2xl sm:text-3xl lg:text-4xl font-display font-bold tabular-nums leading-none"
          style={{ background: GRADIENT, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
        >
          {format(total)}+
        </span>
        <span className="text-[11px] sm:text-[12px] text-muted-foreground font-medium tracking-wide uppercase">Titres</span>

        {hasBreakdown && (
          <div
            role="tooltip"
            className="pointer-events-none absolute left-1/2 top-[calc(100%+0.75rem)] z-30 hidden -translate-x-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 md:block"
          >
            <div className="w-[290px] rounded-xl border border-border/50 bg-popover/95 p-3 shadow-xl backdrop-blur-sm">
              <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Par categorie</div>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
                {CATEGORIES.map(({ type, label, href }) => {
                  const n = stats.byType?.[type] ?? 0;
                  return (
                    <li key={type}>
                      <a
                        href={href}
                        className="pointer-events-auto flex items-baseline justify-between gap-2 rounded-md px-1.5 py-1 text-[12px] transition-colors hover:bg-foreground/[0.06]"
                      >
                        <span className="text-muted-foreground truncate">{label}</span>
                        <span className="font-semibold tabular-nums text-foreground">{format(n)}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-1">
        <span
          className="text-2xl sm:text-3xl lg:text-4xl font-display font-bold tabular-nums leading-none"
          style={{ background: GRADIENT, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
        >
          {CATEGORIES.length}
        </span>
        <span className="text-[11px] sm:text-[12px] text-muted-foreground font-medium tracking-wide uppercase">Categories</span>
      </div>

      <div className="flex flex-col items-center gap-1">
        <span
          className="text-2xl sm:text-3xl lg:text-4xl font-display font-bold leading-none"
          style={{ background: GRADIENT, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
        >
          Gratuit
        </span>
        <span className="text-[11px] sm:text-[12px] text-muted-foreground font-medium tracking-wide uppercase">Acces</span>
      </div>
    </div>
  );
}