import { MediaCard } from './MediaCard';
import type { Media } from '@/lib/api';

interface MediaGridProps {
    title: string;
    items: Media[];
    viewAllHref?: string;
}

export function MediaGrid({ title, items, viewAllHref }: MediaGridProps) {
    return (
        <section className="py-10 px-2">
            <div className="flex items-center justify-between mb-8 border-b border-border/50 pb-4">
                <h2 className="text-2xl font-display font-semibold text-foreground">{title}</h2>
                {viewAllHref && (
                    <a href={viewAllHref} className="text-sm font-medium text-primary hover:underline flex items-center gap-2">
                        Voir tout <span>&rarr;</span>
                    </a>
                )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-8">
                {items.length > 0 ? (
                    items.map((media) => (
                        <MediaCard key={media.id} media={media} />
                    ))
                ) : (
                    <div className="col-span-full py-20 text-center">
                        <p className="text-muted-foreground text-lg">Aucun contenu trouvé dans cette catégorie.</p>
                    </div>
                )}
            </div>
        </section>
    );
}
