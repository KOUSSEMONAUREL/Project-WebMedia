import { useEffect, useRef, useState } from 'react';
import { getMediaStats, type MediaStats } from '@/lib/api';
import type { MediaType } from '@/lib/api';

const CATEGORIES: { type: MediaType; label: string; icon: 'monitor' | 'grid' | 'star' | 'gamepad' | 'book' | 'sparkles' | 'layers' }[] = [
  { type: 'film', label: 'Films', icon: 'monitor' },
  { type: 'serie', label: 'Series', icon: 'grid' },
  { type: 'anime', label: 'Animes', icon: 'star' },
  { type: 'jeu', label: 'Games', icon: 'gamepad' },
  { type: 'book', label: 'Books', icon: 'book' },
  { type: 'novel', label: 'Light Novels', icon: 'sparkles' },
  { type: 'comic', label: 'Comics', icon: 'layers' },
  { type: 'webtoon', label: 'Webtoons', icon: 'layers' },
];

const ICONS: Record<string, string> = {
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  star: '<path d="M12 2l2.4 7.2H22l-6 4.8 2.4 7.2L12 16l-6 4.8L8 14l-6-4.8h7.6z"/>',
  gamepad: '<path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><rect x="2" y="6" width="20" height="12" rx="2"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  layers: '<path d="M12 2L2 7l10 5 10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
};

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
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [target, active]);

  return value;
}

function format(n: number): string {
  return n.toLocaleString('fr-FR').replace(/\u202f/g, ' ');
}

function Counter({ value, className }: { value: number; className?: string }) {
  return <span className={className}>{format(value)}</span>;
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

  if (failed) return null;

  return (
    <div className="flex flex-col items-center gap-8">
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-4xl sm:text-5xl font-display font-bold tabular-nums" style={{ background: 'linear-gradient(135deg,#60a5fa 0%,#3b82f6 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          <Counter value={total} />+
        </span>
        <span className="text-[11px] sm:text-[12px] text-muted-foreground font-medium tracking-wide uppercase">Titres</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-8 w-full max-w-4xl">
        {CATEGORIES.map(({ type, label, icon }) => (
          <CategoryCounter key={type} label={label} icon={icon} value={stats?.byType?.[type] ?? 0} active={ready} />
        ))}
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <span className="text-4xl sm:text-5xl font-display font-bold" style={{ background: 'linear-gradient(135deg,#60a5fa 0%,#3b82f6 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          Gratuit
        </span>
        <span className="text-[11px] sm:text-[12px] text-muted-foreground font-medium tracking-wide uppercase">Acces</span>
      </div>
    </div>
  );
}

function CategoryCounter({ label, icon, value, active }: { label: string; icon: string; value: number; active: boolean }) {
  const shown = useCountUp(value, active);
  return (
    <a href={`/${label === 'Series' ? 'series' : label.toLowerCase().replace(/\s+/g, '-')}`} className="group flex flex-col items-center gap-1.5">
      <svg className="w-5 h-5 sm:w-6 sm:h-6 text-primary/70 group-hover:text-primary transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: ICONS[icon] || '' }} />
      <span className="text-xl sm:text-2xl sm:text-3xl font-display font-bold tabular-nums" style={{ background: 'linear-gradient(135deg,#60a5fa 0%,#3b82f6 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
        <Counter value={shown} />
      </span>
      <span className="text-[11px] sm:text-[12px] text-muted-foreground font-medium tracking-wide uppercase">{label}</span>
    </a>
  );
}