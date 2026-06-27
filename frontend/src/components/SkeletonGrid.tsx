export function SkeletonGrid({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3 animate-pulse">
          <div className="aspect-[2/3] skeleton rounded-xl" />
          <div className="h-4 skeleton rounded w-3/4" />
          <div className="h-3 skeleton rounded w-1/3" />
        </div>
      ))}
    </div>
  );
}
