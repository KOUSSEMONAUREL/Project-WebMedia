import type { Media } from '@/lib/api';
import { MediaCard } from './MediaCard';

interface Props {
  similar?: Media[];
}

export function SimilarSection({ similar }: Props) {
  if (!similar || similar.length === 0) return null;

  return (
    <section>
      <h2 className="text-xl font-display font-bold mb-6">Vous aimerez aussi</h2>
      <div className="flex gap-4 overflow-x-auto pb-4 -mx-6 px-6 snap-x snap-mandatory scrollbar-none">
        {similar.slice(0, 6).map((item) => (
          <div key={item.id} className="flex-shrink-0 snap-start">
            <MediaCard media={item} />
          </div>
        ))}
      </div>
    </section>
  );
}
