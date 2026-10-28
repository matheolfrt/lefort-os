import type { Line } from "@/lib/finance/types";

/** « Comment est calculé ce chiffre ? » — the lines of the calculation with the real values, folded by default */
export function Explain({ lines, note, label = "Comment est calculé ce chiffre ?" }: { lines: Line[]; note?: string; label?: string }) {
  return (
    <details className="group mt-2 text-xs">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-flex size-4 items-center justify-center rounded-full border border-line text-[10px]">?</span>
        <span className="underline decoration-dotted underline-offset-2">{label}</span>
      </summary>
      <div className="mt-2 rounded-xl border border-line bg-bg/70 p-3 font-mono text-[11.5px] leading-relaxed">
        {lines.map((l, i) => (
          <div key={i} className={`flex items-baseline gap-2 ${l.op === "=" ? "mt-1 border-t border-line pt-1 font-semibold text-fg" : l.muted ? "text-muted" : "text-fg/85"}`}>
            <span className="w-3 shrink-0 text-muted">{l.op ?? ""}</span>
            <span className="min-w-0 flex-1 font-sans">{l.label}</span>
            <span className="shrink-0 tabular-nums">{l.value}</span>
          </div>
        ))}
        {note && <p className="mt-2 font-sans text-muted">{note}</p>}
      </div>
    </details>
  );
}
