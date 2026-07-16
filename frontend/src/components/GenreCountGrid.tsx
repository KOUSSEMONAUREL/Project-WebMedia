import { useState, useEffect } from 'react';

const API_BASE = (import.meta.env.PUBLIC_API_URL || 'http://localhost:8787').replace(/\/+$/, '') + '/api';

const GENRE_DATA: { label: string; slug: string }[] = [
  { label: 'Action', slug: 'action' },
  { label: 'Aventure', slug: 'aventure' },
  { label: 'Comedie', slug: 'comedie' },
  { label: 'Drame', slug: 'drame' },
  { label: 'Fantastique', slug: 'fantastique' },
  { label: 'Horreur', slug: 'horreur' },
  { label: 'Mystere', slug: 'mystere' },
  { label: 'Romance', slug: 'romance' },
  { label: 'Science-Fiction', slug: 'science-fiction' },
  { label: 'Thriller', slug: 'thriller' },
  { label: 'Animation', slug: 'animation' },
  { label: 'Documentaire', slug: 'documentaire' },
  { label: 'Crime', slug: 'crime' },
  { label: 'Famille', slug: 'famille' },
];

export default function GenreCountGrid() {
  const [counts, setCounts] = useState<Record<string, { total: number }>>({});

  useEffect(() => {
    fetch(`${API_BASE}/media/genre-counts`)
      .then(r => r.json())
      .then(d => { if (d.success) setCounts(d.data); })
      .catch(() => {});
  }, []);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
      {GENRE_DATA.map(({ label, slug }) => {
        const count = counts[slug]?.total;
        return (
          <a
            key={slug}
            href={`/genres/${slug}`}
            className="group relative h-32 flex flex-col items-start justify-between p-4 rounded-xl bg-gradient-to-br from-card to-card/80 border border-border overflow-hidden transition-all hover:border-primary hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/10"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative w-full flex items-center justify-between">
              <span className="text-sm sm:text-base font-bold uppercase italic tracking-wider transition-colors group-hover:text-primary leading-tight">
                {label}
              </span>
            </div>
            {count !== undefined && (
              <span className="relative self-end px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold tabular-nums transition-all group-hover:bg-primary/20">
                {count.toLocaleString()}
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}
