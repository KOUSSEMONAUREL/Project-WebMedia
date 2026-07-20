import { useRef, useState } from 'react';
import { MediaCard } from './MediaCard';
import type { Media } from '@/lib/api';

const TYPE_ORDER = ['film', 'serie', 'anime', 'jeu', 'webtoon', 'comic', 'book', 'novel'] as const;

function interleave(items: Media[]): Media[] {
  const buckets = new Map<string, Media[]>();
  for (const t of TYPE_ORDER) buckets.set(t, []);
  for (const m of items) {
    const b = buckets.get(m.type);
    if (b) b.push(m);
  }
  const result: Media[] = [];
  let done = false;
  while (!done) {
    done = true;
    for (const t of TYPE_ORDER) {
      const b = buckets.get(t)!;
      if (b.length) {
        result.push(b.shift()!);
        if (b.length) done = false;
      }
    }
  }
  return result;
}

export function TrendingCarousel({ items }: { items: Media[] }) {
  const ordered = interleave(items);
  const doubled = [...ordered, ...ordered];
  const containerRef = useRef<HTMLUListElement>(null);
  const [paused, setPaused] = useState(false);
  const isDraggingRef = useRef(false);
  const dragStartX = useRef(0);
  const dragScrollX = useRef(0);

  const onMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    isDraggingRef.current = true;
    setPaused(true);
    dragStartX.current = e.clientX;
    dragScrollX.current = containerRef.current.scrollLeft;
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current || !containerRef.current) return;
    const dx = e.clientX - dragStartX.current;
    containerRef.current.scrollLeft = dragScrollX.current - dx;
  };

  const onMouseUp = () => {
    isDraggingRef.current = false;
    setPaused(false);
  };

  const onMouseEnter = () => {
    setPaused(true);
  };

  const onMouseLeave = () => {
    setPaused(false);
  };

  return (
    <section className="py-6 sm:py-8 lg:py-10 overflow-hidden" style={{ maskImage: 'linear-gradient(to right, transparent 0, black 4%, black 96%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, transparent 0, black 4%, black 96%, transparent 100%)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 mb-2">
        <h2 className="text-[16px] md:text-[18px] font-display font-bold text-foreground tracking-tight">
          Recommandations
        </h2>
      </div>

      <ul
        ref={containerRef}
        role="listbox"
        aria-label="Recommandations"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className="trending-track flex gap-4 select-none list-none"
        style={{
          padding: '0.75rem 0.25rem 1rem',
          animationPlayState: paused ? 'paused' : 'running',
        } as React.CSSProperties}
      >
        {doubled.map((m, i) => (
          <li key={`${m.id}-${i < ordered.length ? 0 : 1}`}>
            <MediaCard media={m} size="large" isLcp={i === 0} />
          </li>
        ))}
      </ul>

      <style>
        {`
          .trending-track {
            width: max-content;
            animation: trending-scroll 60s linear infinite;
            cursor: grab;
          }
          .trending-track:active {
            cursor: grabbing;
          }
          @keyframes trending-scroll {
            0% { transform: translateX(-50%); }
            100% { transform: translateX(0); }
          }
        `}
      </style>
    </section>
  );
}
