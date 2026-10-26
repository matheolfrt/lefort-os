// Shown instantly while a page loads (prefetched with each link): the layout appears at once instead of a frozen screen
export default function Loading() {
  return (
    <div data-loading aria-busy="true" aria-label="Chargement" className="space-y-5">
      <div className="nav-progress" aria-hidden />
      <div className="space-y-2">
        <div className="skeleton h-8 w-56 rounded-xl" />
        <div className="skeleton h-4 w-80 max-w-full rounded-lg" />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}
      </div>
      <div className="skeleton h-12 rounded-2xl" />
      <div className="space-y-2 rounded-2xl border border-line bg-panel/50 p-4">
        {Array.from({ length: 7 }, (_, i) => <div key={i} className="skeleton h-9 rounded-lg" style={{ opacity: 1 - i * 0.11 }} />)}
      </div>
    </div>
  );
}
