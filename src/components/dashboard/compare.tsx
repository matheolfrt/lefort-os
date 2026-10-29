import { LOW_SAMPLE } from "@/lib/dashboard";
import { gap, type Comparison, type Ref } from "@/lib/compare";

/** How a figure is written: « 1 250 € », « 14 j », « 12 » */
export type Fmt = (v: number) => string;

/**
 * Under a figure: the gap with the same days of last month and with the average of the months before. An arrow AND
 * the words « au-dessus / en dessous » (never the colour alone); green or red only when the direction is good or bad
 * news, grey when it is the same level or the sample is too small to say.
 */
/** How a gap is written: relative (« 18 % »), in days (« 3 j »), or in points for a rate (« 5 pts ») */
export type GapUnit = "pct" | "days" | "points";

export function CompareLines({ c, fmt, unit = "pct" }: { c: Comparison; fmt: Fmt; unit?: GapUnit }) {
  const refs = [c.prev, c.avg].filter((r): r is Ref => r != null);
  if (c.cur == null || !refs.length) return null;
  return (
    <ul className="mt-1.5 space-y-0.5 text-xs leading-snug" data-compare={c.id}>
      {refs.map((r) => {
        const reliable = !c.sample || (c.n >= LOW_SAMPLE && r.n >= LOW_SAMPLE);
        const g = gap(c.cur, r, c.better, reliable)!;
        // « +400 % » reads badly: from three times as much, say « ×5 »
        const amount = unit === "days" ? `${Math.abs(Math.round(g.diff))} j` : unit === "points" ? `${Math.abs(Math.round(g.diff))} pts` : g.pct == null ? ""
          : g.pct >= 2 ? `×${(1 + g.pct).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}` : `${Math.round(Math.abs(g.pct) * 100)} %`;
        const [arrow, word] = g.verdict === "same" ? ["=", "au même niveau"] : g.verdict === "above" ? ["↑", "au-dessus"] : ["↓", "en dessous"];
        const tone = g.good == null ? "text-muted" : g.good ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
        const title = `${fmt(c.cur!)} contre ${fmt(r.value)} ${r.detail}${reliable ? "" : " — peu de données : à prendre avec prudence"}`;
        return (
          <li key={r.label} title={title} data-verdict={g.verdict} data-good={g.good == null ? "" : String(g.good)} className="flex flex-wrap items-baseline gap-x-1">
            <span className={`font-semibold ${tone}`}><span aria-hidden>{arrow}</span> {g.verdict === "same" ? "" : `${amount} `}{word}</span>
            <span className="text-muted">vs {r.label}{reliable ? "" : " · peu de données"}</span>
            <span className="sr-only">: {title}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The last 30 days in a line: gaps where there is no data, the last point (today) marked */
export function Sparkline({ values, fmt, label }: { values: (number | null)[]; fmt: Fmt; label: string }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (pts.length < 2) return null;
  const min = Math.min(...pts.map((p) => p.v)), max = Math.max(...pts.map((p) => p.v));
  const W = 100, H = 24, pad = 2;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => (max === min ? H / 2 : pad + (1 - (v - min) / (max - min)) * (H - 2 * pad));
  // one segment per run of consecutive days with data
  const segs: string[] = [];
  let cur = "";
  values.forEach((v, i) => {
    if (v == null) { if (cur) segs.push(cur); cur = ""; return; }
    cur += `${cur ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`;
  });
  if (cur) segs.push(cur);
  const last = values.at(-1);
  const desc = `${label}, 30 derniers jours : de ${fmt(min)} à ${fmt(max)}${last != null ? `, aujourd'hui ${fmt(last)}` : ""}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={desc} data-spark
      className="mt-2 h-6 w-full overflow-visible text-series-1">
      <title>{desc}</title>
      {segs.map((d, i) => <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
      {last != null && <circle cx={x(values.length - 1)} cy={y(last)} r={2} fill="currentColor" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
