import { useMemo } from 'react';

interface Props {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function ChannelPagination({ page, totalPages, onPageChange }: Props) {
  const pageNumbers = useMemo(() => {
    const cur = page + 1;
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | string)[] = [1];
    const start = Math.max(2, cur - 2);
    const end = Math.min(totalPages - 1, cur + 2);
    if (start > 2) pages.push('...');
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < totalPages - 1) pages.push('...');
    pages.push(totalPages);
    return pages;
  }, [page, totalPages]);

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-1 mt-8">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page === 0}
        className="px-3 py-1.5 text-sm rounded-lg bg-card border border-border disabled:opacity-30 hover:border-primary/50 transition-colors"
      >
        Prev
      </button>
      {pageNumbers.map((p, i) =>
        typeof p === 'string' ? (
          <span key={`e${i}`} className="px-2 text-muted-foreground">...</span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p - 1)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              p === page + 1
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card border-border hover:border-primary/50'
            }`}
          >
            {p}
          </button>
        )
      )}
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages - 1}
        className="px-3 py-1.5 text-sm rounded-lg bg-card border border-border disabled:opacity-30 hover:border-primary/50 transition-colors"
      >
        Next
      </button>
    </div>
  );
}
