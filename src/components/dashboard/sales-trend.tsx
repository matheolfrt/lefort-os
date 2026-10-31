"use client";

import { seg } from "@/components/ui";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cumulative, toDate, type DayPoint, type TrendPeriod } from "@/lib/trend";

// The month (or the week) as it goes: revenue added up day by day against the previous period and the objective,
// then revenue and items sold day by day. One measure per chart, never two scales on one plot.

type Kind = "month" | "week";
const euro0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur = (cents: number) => euro0.format(Math.round(cents / 100));
const eurShort = (cents: number) => {
  const v = cents / 100;
  return v >= 10_000 ? `${Math.round(v / 1000)} k€` : v >= 1000 ? `${(v / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k€` : `${Math.round(v)} €`;
};
const WEEKDAYS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const dayLabel = (p: DayPoint, kind: Kind, i: number) =>
  kind === "week" ? WEEKDAYS[i] : String(Number(p.day.slice(8, 10)));
const longDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/**
 * Days written under the axis: every day for a week; for a month the 1st, every 5th (or 7th on a phone) and today,
 * leaving out those too close to today so labels never overlap
 */
function axisDays(n: number, kind: Kind, today: number, narrow: boolean) {
  if (kind === "week") return new Set(Array.from({ length: n }, (_, i) => i));
  const step = narrow ? 7 : 5;
  const keep = new Set<number>([0, today]);
  for (let i = step - 1; i < n; i += step) if (Math.abs(i - today) > (narrow ? 3 : 2)) keep.add(i);
  return keep;
}

/** A round upper bound for an axis: 1, 2, 2.5 or 5 × a power of ten */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

/** Width of the chart's box, so the drawing is at real size (text stays sharp and readable) */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function SalesTrend({ trend }: { trend: { month: TrendPeriod; week: TrendPeriod } }) {
  const [kind, setKind] = useState<Kind>("month");
  useEffect(() => {
    try { const k = localStorage.getItem("trendPeriod"); if (k === "week" || k === "month") setKind(k); } catch { /* private mode */ }
  }, []);
  const choose = (k: Kind) => { setKind(k); try { localStorage.setItem("trendPeriod", k); } catch { /* private mode */ } };
  const p = trend[kind];
  const t = toDate(p);
  const prevName = kind === "month" ? p.prevLabel.toLowerCase() : "la semaine dernière";
  const sinceStart = kind === "month" ? `au ${p.todayIndex + 1}` : `à ${WEEKDAYS[p.todayIndex].replace(".", "")}.`;

  return (
    <section data-testid="sales-trend" aria-labelledby="trend-title">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="trend-title" className="section-title">Évolution des ventes</h2>
        <div role="radiogroup" aria-label="Période" className={seg.wrap}>
          {(["month", "week"] as Kind[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => choose(k)}
              className={`${seg.item(kind === k)} max-sm:min-h-11`}>
              {k === "month" ? "Ce mois" : "Cette semaine"}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-panel/80 p-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          <Figure label={`CA ${kind === "month" ? p.label.toLowerCase() : "de la semaine"}`} value={eur(t.cur.revenue)}
            delta={<Delta cur={t.cur.revenue} prev={t.prev.revenue} text={`vs ${prevName} ${sinceStart}`} pct />} />
          <Figure label="Articles vendus" value={String(t.cur.sales)}
            delta={<Delta cur={t.cur.sales} prev={t.prev.sales} text={`vs ${prevName} ${sinceStart}`} />} />
          <Figure label="Prix moyen" value={t.cur.sales ? eur(t.cur.revenue / t.cur.sales) : "—"}
            delta={<span className="text-xs text-muted">{t.prev.sales ? `${eur(t.prev.revenue / t.prev.sales)} ${prevName}` : " "}</span>} />
          <Figure label={t.goal ? "Objectif" : "Projection"}
            value={t.goal ? eur(t.goal) : t.projection != null ? eur(t.projection) : "—"}
            delta={<span className="text-xs text-muted">
              {t.goal ? `${Math.round((t.cur.revenue / t.goal) * 100)} % atteint${t.projection != null ? ` · projection ${eur(t.projection)}` : ""}`
                : t.projection != null ? `fin de ${kind === "month" ? "mois" : "semaine"}, au rythme actuel` : "trop tôt pour projeter"}
            </span>} />
        </div>

        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-sm font-medium">Chiffre d&apos;affaires cumulé</h3>
            <Legend items={[
              { label: kind === "month" ? p.label : "Cette semaine", tone: "cur" },
              { label: kind === "month" ? p.prevLabel : "Semaine précédente", tone: "prev" },
              ...(p.goalPerDay != null ? [{ label: "Objectif", tone: "goal" as const }] : []),
            ]} />
          </div>
          <CumulativeChart p={p} kind={kind} />
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium">CA par jour</h3>
            <DailyBars p={p} kind={kind} measure="revenue" />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium">Articles vendus par jour</h3>
            <DailyBars p={p} kind={kind} measure="sales" />
          </div>
        </div>

        <details className="mt-4 text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center text-muted hover:text-fg">Voir les chiffres jour par jour</summary>
          <div className="mt-2 max-h-80 overflow-auto">
            <table className="data">
              <thead><tr><th>Jour</th><th className="num">CA</th><th className="num">Articles</th><th className="num">CA cumulé</th></tr></thead>
              <tbody>
                {p.days.map((d, i) => d.future ? null : (
                  <tr key={d.day}>
                    <td className="capitalize">{longDay(d.day)}</td>
                    <td className="num">{eur(d.revenue)}</td>
                    <td className="num">{d.sales}</td>
                    <td className="num">{eur(cumulative(p.days, "revenue", p.todayIndex)[i] ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </section>
  );
}

function Figure({ label, value, delta }: { label: string; value: string; delta: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow-tight truncate text-muted">{label}</div>
      <div className="mt-0.5 figure text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="min-h-4">{delta}</div>
    </div>
  );
}

/** Up / down against the previous period: an arrow and words, never colour alone */
function Delta({ cur, prev, text, pct }: { cur: number; prev: number; text: string; pct?: boolean }) {
  if (!prev && !cur) return <span className="text-xs text-muted">{text.replace(/^vs /, "comme ")} : 0</span>;
  if (!prev) return <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-accent"><ArrowUpRight size={13} /> nouveau <span className="font-normal text-muted">{text}</span></span>;
  const diff = cur - prev;
  const shown = pct ? `${diff >= 0 ? "+" : "−"}${Math.abs(Math.round((diff / prev) * 100))} %` : `${diff >= 0 ? "+" : "−"}${Math.abs(diff)}`;
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1 text-xs font-semibold ${diff > 0 ? "text-accent" : diff < 0 ? "text-red-300" : "text-muted"}`}>
      <Icon size={13} aria-hidden /> {shown} <span className="font-normal text-muted">{text}</span>
    </span>
  );
}

const TONE = {
  cur: { stroke: "var(--series-1)", key: "bg-series-1" },
  prev: { stroke: "var(--series-2)", key: "bg-series-2" },
  goal: { stroke: "var(--fg)", key: "" },
} as const;

function Legend({ items }: { items: { label: string; tone: keyof typeof TONE }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          {it.tone === "goal"
            ? <span aria-hidden className="w-4 border-t-2 border-dashed border-fg/50" />
            : <span aria-hidden className={`h-0.5 w-4 rounded-full ${TONE[it.tone].key}`} />}
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** Tooltip box: values first, strong; series named after a short line in its colour */
function Tip({ x, width, title, rows }: { x: number; width: number; title: string; rows: { label: string; value: string; tone?: keyof typeof TONE }[] }) {
  const left = Math.min(Math.max(x - 100, 0), Math.max(0, width - 200));
  return (
    <div role="status" className="pointer-events-none absolute top-0 z-10 w-[200px] rounded-xl border border-line bg-panel-2/95 p-2.5 text-xs shadow-xl backdrop-blur" style={{ left }}>
      <div className="mb-1 capitalize text-muted">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          {r.tone && (r.tone === "goal"
            ? <span aria-hidden className="w-3 border-t-2 border-dashed border-fg/50" />
            : <span aria-hidden className={`h-0.5 w-3 rounded-full ${TONE[r.tone].key}`} />)}
          <span className="figure font-semibold tabular-nums text-fg">{r.value}</span>
          <span className="truncate text-muted">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

const PAD = { l: 44, r: 12, t: 12, b: 24 };

function CumulativeChart({ p, kind }: { p: TrendPeriod; kind: Kind }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const W = Math.max(width, 280), H = width < 500 ? 180 : 220;
  const n = p.days.length;
  const cur = cumulative(p.days, "revenue", p.todayIndex);
  const prev = cumulative(p.prev, "revenue").slice(0, n);
  const goal = p.goalPerDay != null ? p.days.map((_, i) => p.goalPerDay! * (i + 1)) : null;
  const max = niceMax(Math.max(1, ...cur.map((v) => v ?? 0), ...prev.map((v) => v ?? 0), ...(goal ?? [])));
  const x = (i: number) => PAD.l + (n === 1 ? 0 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const path = (vals: (number | null)[]) => vals.reduce<string>((d, v, i) => (v == null ? d : `${d}${d ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`), "");
  const ticks = [0, max / 2, max];
  const labels = axisDays(n, kind, p.todayIndex, W < 420);
  const showLabel = (i: number) => labels.has(i);
  const last = cur[p.todayIndex] ?? 0;
  const pick = (clientX: number, rect: DOMRect) => {
    const i = Math.round(((clientX - rect.left - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={W} height={H} className="block touch-pan-y" role="img"
          aria-label={`Chiffre d'affaires cumulé : ${eur(last)} à ce jour, contre ${eur(prev[Math.min(p.todayIndex, prev.length - 1)] ?? 0)} à la même date de la période précédente`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
              <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="fill-muted text-[10px]">{eurShort(v)}</text>
            </g>
          ))}
          {p.days.map((d, i) => showLabel(i) && (
            <text key={d.day} x={x(i)} y={H - 6} textAnchor="middle" className={`text-[10px] ${i === p.todayIndex ? "fill-fg font-semibold" : "fill-muted"}`}>{dayLabel(d, kind, i)}</text>
          ))}
          {goal && <path d={path(goal)} fill="none" stroke="var(--fg)" strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="4 4" />}
          <path d={path(prev)} fill="none" stroke={TONE.prev.stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={path(cur)} fill="none" stroke={TONE.cur.stroke} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          {/* today: a dot ringed with the surface, and its value as the one direct label */}
          <circle cx={x(p.todayIndex)} cy={y(last)} r={4.5} fill={TONE.cur.stroke} stroke="var(--panel)" strokeWidth={2} />
          <text x={Math.min(x(p.todayIndex) + 8, W - PAD.r - 2)} y={y(last) - 8} textAnchor={x(p.todayIndex) > W - 80 ? "end" : "start"}
            className="fill-fg figure text-[11px] font-semibold">{eur(last)}</text>
          {hover != null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--fg)" strokeOpacity={0.35} strokeWidth={1} />
              {cur[hover] != null && <circle cx={x(hover)} cy={y(cur[hover]!)} r={4} fill={TONE.cur.stroke} stroke="var(--panel)" strokeWidth={2} />}
              {prev[hover] != null && <circle cx={x(hover)} cy={y(prev[hover]!)} r={4} fill={TONE.prev.stroke} stroke="var(--panel)" strokeWidth={2} />}
            </g>
          )}
          {/* the whole plot is the hit area: the crosshair finds the day nearest the finger */}
          <rect x={PAD.l - 8} y={0} width={W - PAD.l - PAD.r + 16} height={H} fill="transparent" tabIndex={0}
            aria-label="Parcourir les jours avec les flèches"
            onPointerMove={(e) => pick(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect())}
            onPointerDown={(e) => pick(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect())}
            onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)}
            onFocus={() => setHover(p.todayIndex)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") { e.preventDefault(); setHover((h) => Math.max(0, (h ?? p.todayIndex) - 1)); }
              if (e.key === "ArrowRight") { e.preventDefault(); setHover((h) => Math.min(n - 1, (h ?? p.todayIndex) + 1)); }
            }}
            className="outline-none" />
        </svg>
      )}
      {width === 0 && <div style={{ height: 220 }} />}
      {hover != null && (
        <Tip x={x(hover)} width={W} title={longDay(p.days[hover].day)} rows={[
          { label: kind === "month" ? p.label : "Cette semaine", value: cur[hover] != null ? eur(cur[hover]!) : "à venir", tone: "cur" },
          ...(prev[hover] != null ? [{ label: kind === "month" ? p.prevLabel : "Sem. précédente", value: eur(prev[hover]!), tone: "prev" as const }] : []),
          ...(goal ? [{ label: "Objectif", value: eur(goal[hover]), tone: "goal" as const }] : []),
        ]} />
      )}
    </div>
  );
}

function DailyBars({ p, kind, measure }: { p: TrendPeriod; kind: Kind; measure: "revenue" | "sales" }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const W = Math.max(width, 260), H = 140;
  const n = p.days.length;
  const vals = p.days.map((d) => (d.future ? null : d[measure]));
  const max = niceMax(Math.max(1, ...vals.map((v) => v ?? 0)));
  const fmt = (v: number) => (measure === "revenue" ? eur(v) : `${v} article${v > 1 ? "s" : ""}`);
  const axis = (v: number) => (measure === "revenue" ? eurShort(v) : String(v));
  const plotW = W - PAD.l - PAD.r;
  const slot = plotW / n, gap = Math.min(4, slot * 0.25), bw = Math.max(2, slot - gap);
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const base = H - PAD.b;
  const best = vals.reduce<number>((b, v, i) => ((v ?? -1) > (vals[b] ?? -1) ? i : b), 0);
  const labels = axisDays(n, kind, p.todayIndex, W < 420);

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={W} height={H} className="block" role="img"
          aria-label={`${measure === "revenue" ? "Chiffre d'affaires" : "Articles vendus"} par jour, meilleur jour : ${fmt(vals[best] ?? 0)}`}>
          {[0, max].map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
              <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="fill-muted text-[10px]">{axis(v)}</text>
            </g>
          ))}
          {p.days.map((d, i) => {
            const v = vals[i];
            const bx = PAD.l + i * slot + gap / 2;
            const h = v ? Math.max(3, base - y(v)) : 0;
            const r = Math.min(4, bw / 2, h);
            const show = labels.has(i);
            return (
              <g key={d.day} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                {/* the hit area is the whole day column, not just the bar */}
                <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={base - PAD.t} fill="transparent" />
                {h > 0 && (
                  <path d={`M${bx},${base} V${base - h + r} q0,-${r} ${r},-${r} H${bx + bw - r} q${r},0 ${r},${r} V${base} Z`}
                    fill="var(--series-1)" fillOpacity={hover === i || (hover == null && i === p.todayIndex) ? 1 : 0.7} />
                )}
                {v === 0 && <rect x={bx} y={base - 1} width={bw} height={1} fill="var(--muted)" opacity={0.5} />}
                {show && <text x={bx + bw / 2} y={H - 6} textAnchor="middle" className={`text-[10px] ${i === p.todayIndex ? "fill-fg font-semibold" : "fill-muted"}`}>{dayLabel(d, kind, i)}</text>}
              </g>
            );
          })}
          {/* the best day is the one value written on the chart */}
          {(vals[best] ?? 0) > 0 && hover == null && (
            <text x={Math.min(Math.max(PAD.l + best * slot + slot / 2, PAD.l + 16), W - PAD.r - 16)} y={y(vals[best]!) - 5} textAnchor="middle"
              className="fill-fg figure text-[10px] font-semibold">{axis(vals[best]!)}</text>
          )}
        </svg>
      )}
      {width === 0 && <div style={{ height: 140 }} />}
      {hover != null && (
        <Tip x={PAD.l + hover * slot + slot / 2} width={W} title={longDay(p.days[hover].day)}
          rows={[{ label: measure === "revenue" ? "de CA" : "vendus", value: vals[hover] == null ? "à venir" : measure === "revenue" ? eur(vals[hover]!) : String(vals[hover]) }]} />
      )}
    </div>
  );
}
