import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.PUBLIC_API_URL || 'http://localhost:8787/api';

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
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {GENRE_DATA.map(({ label, slug }) => {
        const count = counts[slug]?.total;
        return (
          <a
            key={slug}
            href={`/genres/${slug}`}
            className="group relative h-32 flex items-center justify-center rounded-xl bg-card border border-border overflow-hidden transition-all hover:border-primary hover:scale-[1.02]"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-lg font-bold uppercase italic tracking-wider transition-colors group-hover:text-primary">
                {label}
              </span>
              {count !== undefined && (
                <span className="text-xs text-muted-foreground font-mono">
                  {count.toLocaleString()} media{count !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </a>
        );
      })}
    </div>
  );
}
