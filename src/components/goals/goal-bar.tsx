import { advice, formatValue, METRIC_LABEL, PACE_LABEL, type Pace, type Standing } from "@/lib/goals";

const PACE_TONE: Record<Pace, { bar: string; chip: string }> = {
  done: { bar: "bg-accent", chip: "bg-accent/15 text-accent" },
  ahead: { bar: "bg-accent", chip: "bg-accent/15 text-accent" },
  on_track: { bar: "bg-emerald-400/80", chip: "bg-emerald-400/10 text-emerald-300" },
  behind: { bar: "bg-amber-400", chip: "bg-amber-400/15 text-amber-300" },
  late: { bar: "bg-red-400", chip: "bg-red-500/15 text-red-300" },
};

/** One objective: done / target, a bar with a mark where an even pace would be, and what remains to do */
export function GoalBar({ s, compact }: { s: Standing; compact?: boolean }) {
  const tone = PACE_TONE[s.pace];
  return (
    <div data-goal={`${s.period}:${s.metric}`} data-pace={s.pace}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-sm font-medium text-fg/85">{METRIC_LABEL[s.metric]}</span>
        <span className="font-mono text-sm tabular-nums">
          <strong className="text-base text-fg">{formatValue(s.metric, s.actual, true)}</strong>
          <span className="text-muted"> / {formatValue(s.metric, s.target.value, true)}{s.target.own ? "" : "*"}</span>
        </span>
      </div>
      <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full bg-fg/10"
        role="progressbar" aria-label={`${METRIC_LABEL[s.metric]} : ${s.pct} % de l'objectif`} aria-valuenow={Math.min(100, s.pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full transition-[width] duration-500 ${tone.bar}`} style={{ width: `${Math.min(100, s.pct)}%` }} />
        {s.period !== "day" && s.pace !== "done" && s.elapsedPct > 0 && s.elapsedPct < 100 && (
          <span aria-hidden title="Où il faudrait en être à un rythme régulier"
            className="absolute inset-y-0 w-0.5 bg-fg/60" style={{ left: `${s.elapsedPct}%` }} />
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span className={`rounded-full px-2 py-0.5 font-semibold ${tone.chip}`}>{s.pct} % · {PACE_LABEL[s.pace]}</span>
        {!compact && <span>{advice(s)}</span>}
      </div>
    </div>
  );
}
