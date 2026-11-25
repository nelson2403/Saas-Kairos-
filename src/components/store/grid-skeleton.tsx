export function GridSkeleton() {
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 px-4 md:grid-cols-4 md:px-6" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="aspect-[4/5] animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}
