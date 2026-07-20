import type { Media } from '../lib/api';
import { MediaCard } from './MediaCard';
import { EmptyState } from './EmptyState';

interface Props {
  icon: React.ReactNode;
  title: string;
  items: { id: string; media: Media }[];
  emptyTitle: string;
  emptyDescription: string;
}

export function MediaGridTab({ icon, title, items, emptyTitle, emptyDescription }: Props) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        {icon}
        <h2 className="text-lg font-display font-semibold text-foreground">{title}</h2>
      </div>

      {items.length === 0 ? (
        <div className="py-12">
          <EmptyState title={emptyTitle} description={emptyDescription} />
        </div>
      ) : (
        <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4">
          {items.map(item => (
            <MediaCard key={item.id} media={item.media} />
          ))}
        </div>
      )}
    </div>
  );
}
