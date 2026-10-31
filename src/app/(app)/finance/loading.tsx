// The command center's own outline while its figures are computed: title, sections, eight figures, the capital ring
export default function Loading() {
  return (
    <div data-loading aria-busy="true" aria-label="Chargement" className="space-y-8">
      <div className="nav-progress" aria-hidden />
      <div className="space-y-2">
        <div className="skeleton h-8 w-64 rounded-xl" />
        <div className="skeleton h-4 w-96 max-w-full rounded-lg" />
      </div>
      <div className="flex gap-1 overflow-hidden">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-10 w-24 shrink-0 rounded-full" />)}
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="space-y-2 rounded-2xl border border-line bg-panel/80 p-4">
            <div className="skeleton h-3 w-24 rounded" /><div className="skeleton h-8 w-32 rounded-lg" /><div className="skeleton h-3 w-40 max-w-full rounded" />
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <div className="skeleton h-6 w-56 rounded-lg" />
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <div className="flex items-center gap-6 rounded-2xl border border-line bg-panel/80 p-4">
            <div className="skeleton size-40 shrink-0 rounded-full" />
            <div className="flex-1 space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-6 rounded" />)}</div>
          </div>
          <div className="skeleton h-32 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
