"use client";

import { useState } from "react";

// Small SVG charts in the app's style: thin marks, recessive grid, one y-axis, hover tooltip.
// Series colors come from --series-1 / --series-2 (validated pair); text always stays in text colors.

const MONTH = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export const monthLabel = (key: string, withYear = false) =>
  `${MONTH[Number(key.slice(5, 7)) - 1]}${withYear ? ` ${key.slice(0, 4)}` : ""}`;

export interface Series { label: string; color: "series-1" | "series-2"; values: (number | null)[] }

const FILL = { "series-1": "fill-series-1", "series-2": "fill-series-2" };
const STROKE = { "series-1": "stroke-series-1", "series-2": "stroke-series-2" };
const BG = { "series-1": "bg-series-1", "series-2": "bg-series-2" };

const H = 190, TOP = 8, BOTTOM = 4;
const widthOf = (wide?: boolean) => (wide ? 1100 : 600);

/** Round axis maximum and 3 ticks (0, half, max) */
function scale(values: number[]) {
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = 10 ** Math.floor(Math.log10(span / 2));
  const niceMax = max > 0 ? Math.ceil(max / step) * step : 0;
  const niceMin = min < 0 ? Math.floor(min / step) * step : 0;
  const y = (v: number) => TOP + ((niceMax - v) / (niceMax - niceMin || 1)) * (H - TOP - BOTTOM);
  const ticks = niceMin < 0 ? [niceMax, 0, niceMin] : [niceMax, niceMax / 2, 0];
  return { y, ticks };
}

export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {series.map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1.5">
          <span className={`size-2.5 rounded-sm ${BG[s.color]}`} /> {s.label}
        </span>
      ))}
    </div>
  );
}

function Frame({ W, months, ticks, y, format, hover, setHover, tooltip, children }: {
  W: number; months: string[]; ticks: number[]; y: (v: number) => number; format: (v: number) => string;
  hover: number | null; setHover: (i: number | null) => void; tooltip: React.ReactNode; children: React.ReactNode;
}) {
  const colW = W / months.length;
  return (
    <div className="relative">
      <div className="relative pl-12">
        {/* y ticks, in HTML so they keep their size */}
        {ticks.map((t) => (
          <span key={t} className="absolute left-0 w-11 -translate-y-1/2 text-right text-[10px] tabular-nums text-muted"
            style={{ top: `${(y(t) / H) * 100}%` }}>{format(t)}</span>
        ))}
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <line key={t} x1="0" x2={W} y1={y(t)} y2={y(t)} className={t === 0 ? "stroke-fg/30" : "stroke-line"} strokeWidth="1"
                strokeDasharray={t === 0 ? undefined : "3 4"} vectorEffect="non-scaling-stroke" />
            ))}
            {hover != null && <rect x={hover * colW} y={TOP} width={colW} height={H - TOP - BOTTOM} className="fill-fg/5" />}
            {children}
            {/* hit targets: one full-height column per month */}
            {months.map((m, i) => (
              <rect key={m} x={i * colW} y="0" width={colW} height={H} fill="transparent"
                onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
            ))}
          </svg>
          {hover != null && (
            <div className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-lg"
              style={{ left: `${((hover + 0.5) / months.length) * 100}%`,
                transform: hover >= months.length / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}>
              <div className="mb-1 font-semibold">{monthLabel(months[hover], true)}</div>
              {tooltip}
            </div>
          )}
        </div>
      </div>
      <div className="mt-1 flex pl-12 text-center text-[10px] text-muted">
        {months.map((m, i) => (
          <span key={m} className={`w-0 min-w-0 flex-1 whitespace-nowrap ${months.length > 12 && i % 3 ? "invisible" : months.length > 6 && i % 2 ? "max-sm:invisible" : ""}`}>
            {monthLabel(m, months.length > 12 && m.endsWith("-01"))}
          </span>
        ))}
      </div>
    </div>
  );
}

function TooltipRows({ series, i, format }: { series: Series[]; i: number; format: (v: number) => string }) {
  return (
    <>
      {series.map((s) => (
        <div key={s.label} className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted"><span className={`size-2 rounded-sm ${BG[s.color]}`} />{s.label}</span>
          <span className="font-semibold tabular-nums">{s.values[i] == null ? "—" : format(s.values[i]!)}</span>
        </div>
      ))}
    </>
  );
}

/** One or two series of bars per month (same unit, one axis) */
export function MonthBars({ months, series, format, extra, wide }: {
  months: string[]; series: Series[]; format: (v: number) => string; extra?: (i: number) => React.ReactNode; wide?: boolean;
}) {
  const W = widthOf(wide);
  const [hover, setHover] = useState<number | null>(null);
  const { y, ticks } = scale(series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const colW = W / months.length;
  const pad = Math.min(colW * 0.18, 10);
  const gap = 2;
  const bw = (colW - pad * 2 - gap * (series.length - 1)) / series.length;
  return (
    <Frame W={W} months={months} ticks={ticks} y={y} format={format} hover={hover} setHover={setHover}
      tooltip={hover != null && <><TooltipRows series={series} i={hover} format={format} />{extra?.(hover)}</>}>
      {series.map((s, si) => s.values.map((v, i) => {
        if (!v) return null;
        const x = i * colW + pad + si * (bw + gap);
        const y0 = y(0), y1 = y(v);
        const top = Math.min(y0, y1), h = Math.max(Math.abs(y1 - y0), 2);
        const r = Math.min(4, bw / 2, h);
        // rounded at the data end, square on the baseline
        const d = v > 0
          ? `M${x},${y0} V${top + r} q0,-${r} ${r},-${r} H${x + bw - r} q${r},0 ${r},${r} V${y0} Z`
          : `M${x},${y0} V${top + h - r} q0,${r} ${r},${r} H${x + bw - r} q${r},0 ${r},-${r} V${y0} Z`;
        return <path key={`${si}-${i}`} d={d} className={FILL[s.color]} opacity={hover == null || hover === i ? 1 : 0.55} />;
      }))}
    </Frame>
  );
}

/** One series as a line; gaps where the value is unknown */
export function MonthLine({ months, series, format, extra, wide }: {
  months: string[]; series: Series; format: (v: number) => string; extra?: (i: number) => React.ReactNode; wide?: boolean;
}) {
  const W = widthOf(wide);
  const [hover, setHover] = useState<number | null>(null);
  const { y, ticks } = scale(series.values.map((v) => v ?? 0));
  const colW = W / months.length;
  const x = (i: number) => i * colW + colW / 2;
  const segments: string[] = [];
  let cur = "";
  series.values.forEach((v, i) => {
    if (v == null) { if (cur) segments.push(cur); cur = ""; return; }
    cur += `${cur ? "L" : "M"}${x(i)},${y(v)} `;
  });
  if (cur) segments.push(cur);
  return (
    <Frame W={W} months={months} ticks={ticks} y={y} format={format} hover={hover} setHover={setHover}
      tooltip={hover != null && <><TooltipRows series={[series]} i={hover} format={format} />{extra?.(hover)}</>}>
      {segments.map((d) => (
        <path key={d} d={d} fill="none" className={STROKE[series.color]} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      ))}
      {series.values.map((v, i) => {
        const isolated = series.values[i - 1] == null && series.values[i + 1] == null;
        return v != null && (hover === i || isolated) && (
          <circle key={i} cx={x(i)} cy={y(v)} r="5" className={`${FILL[series.color]} stroke-panel`} strokeWidth="2" />
        );
      })}
    </Frame>
  );
}

/** Ranked horizontal bars with the value written at the end (no hover needed: every value is labelled) */
export function RankBars({ rows, format, detail }: {
  rows: { name: string; value: number; detail?: string }[]; format: (v: number) => string; detail?: string;
}) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return (
    <ul className="space-y-2" aria-label={detail}>
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm" title={r.detail}>
          <span className="truncate">{r.name}</span>
          <span className="h-3 overflow-hidden rounded-r bg-bg">
            <span className={`block h-full rounded-r ${r.value < 0 ? "bg-red-500" : "bg-series-1"}`}
              style={{ width: r.value ? `${Math.max(2, (Math.abs(r.value) / max) * 100)}%` : 0 }} />
          </span>
          <span className="text-right tabular-nums">
            <span className="font-semibold">{format(r.value)}</span>
            {r.detail && <span className="block text-[11px] text-muted">{r.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
