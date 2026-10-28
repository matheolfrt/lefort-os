"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ForecastPoint } from "@/lib/finance/calc";

// Cash ahead: the central line (sales at their recent pace), a band between the low and high hypotheses, and the
// safety reserve as a dashed line. One measure, one scale. Never drawn as a certainty: the band is always there.

const euro0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur = (c: number) => euro0.format(Math.round(c / 100));
const eurShort = (c: number) => {
  const v = c / 100, a = Math.abs(v), s = v < 0 ? "−" : "";
  return a >= 10_000 ? `${s}${Math.round(a / 1000)} k€` : a >= 1000 ? `${s}${(a / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k€` : `${s}${Math.round(a)} €`;
};
const longDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" });
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

function nice(min: number, max: number) {
  const span = Math.max(1, max - min);
  const p = 10 ** Math.floor(Math.log10(span / 4));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * p * 4 >= span) ?? 10) * p;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

const PAD = { l: 52, r: 14, t: 14, b: 24 };

export function ForecastChart({ points, reserve, known }: { points: ForecastPoint[]; reserve: number; known: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = Math.max(width, 280), H = width < 500 ? 200 : 240;
  const n = points.length;
  const vals = points.flatMap((p) => [p.low, p.high, p.base]);
  const showReserve = known && reserve > 0;
  const { lo, hi, ticks } = nice(Math.min(0, ...vals, showReserve ? reserve : 0), Math.max(1, ...vals, showReserve ? reserve : 0));
  const x = (i: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b);
  const line = (k: "base" | "low" | "high") => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  const band = `${line("high")}${[...points].reverse().map((p, j) => `L${x(n - 1 - j).toFixed(1)},${y(p.low).toFixed(1)}`).join("")}Z`;
  const marks = [7, 30, 60, 90, 180, 365].filter((d) => d < n);
  const narrow = W < 420;
  const axis = narrow ? marks.filter((d) => d !== 7 && d !== 60) : marks;
  const last = points[n - 1];
  const pick = (clientX: number, rect: DOMRect) => {
    const i = Math.round(((clientX - rect.left - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };
  const h = hover != null ? points[hover] : null;

  return (
    <div ref={ref} className="relative" data-testid="forecast-chart">
      {width > 0 && (
        <svg width={W} height={H} className="block touch-pan-y" role="img"
          aria-label={`Prévision de trésorerie : ${eur(last.base)} dans ${n - 1} jours selon le rythme actuel, entre ${eur(last.low)} et ${eur(last.high)}`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} strokeOpacity={v === 0 ? 1 : 0.6} />
              <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="fill-muted text-[10px]">{eurShort(v)}</text>
            </g>
          ))}
          {axis.map((d) => (
            <text key={d} x={x(d)} y={H - 6} textAnchor="middle" className="fill-muted text-[10px]">J+{d}</text>
          ))}
          <text x={x(0)} y={H - 6} textAnchor="start" className="fill-fg text-[10px] font-semibold">Auj.</text>
          <path d={band} fill="var(--series-1)" fillOpacity={0.14} />
          <path d={line("low")} fill="none" stroke="var(--series-1)" strokeOpacity={0.35} strokeWidth={1} />
          <path d={line("high")} fill="none" stroke="var(--series-1)" strokeOpacity={0.35} strokeWidth={1} />
          {showReserve && (
            <g>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(reserve)} y2={y(reserve)} stroke="#d95926" strokeWidth={1.5} strokeDasharray="5 4" />
              <text x={W - PAD.r - 2} y={y(reserve) - 5} textAnchor="end" className="fill-[#e8875f] text-[10px] font-semibold">Réserve {eurShort(reserve)}</text>
            </g>
          )}
          <path d={line("base")} fill="none" stroke="var(--series-1)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(n - 1)} cy={y(last.base)} r={4} fill="var(--series-1)" stroke="var(--panel)" strokeWidth={2} />
          <text x={x(n - 1) - 8} y={y(last.base) - 8} textAnchor="end" className="fill-fg font-mono text-[11px] font-semibold">{eur(last.base)}</text>
          {hover != null && h && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--fg)" strokeOpacity={0.35} />
              <circle cx={x(hover)} cy={y(h.base)} r={4} fill="var(--series-1)" stroke="var(--panel)" strokeWidth={2} />
            </g>
          )}
          <rect x={PAD.l - 8} y={0} width={W - PAD.l - PAD.r + 16} height={H} fill="transparent" tabIndex={0} className="outline-none"
            aria-label="Parcourir les jours avec les flèches"
            onPointerMove={(e) => pick(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect())}
            onPointerDown={(e) => pick(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect())}
            onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)} onFocus={() => setHover(Math.min(30, n - 1))}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") { e.preventDefault(); setHover((v) => Math.max(0, (v ?? 0) - 1)); }
              if (e.key === "ArrowRight") { e.preventDefault(); setHover((v) => Math.min(n - 1, (v ?? 0) + 1)); }
            }} />
        </svg>
      )}
      {width === 0 && <div style={{ height: 240 }} />}
      {h && hover != null && (
        <div role="status" className="pointer-events-none absolute top-0 z-10 w-[210px] rounded-xl border border-line bg-panel-2/95 p-2.5 text-xs shadow-xl backdrop-blur"
          style={{ left: Math.min(Math.max(x(hover) - 105, 0), Math.max(0, W - 210)) }}>
          <div className="mb-1 capitalize text-muted">{hover === 0 ? "Aujourd'hui" : `${longDay(h.day)} · J+${hover}`}</div>
          <div className="flex items-baseline justify-between gap-2"><span className="text-muted">Prévu</span><span className="font-mono font-semibold tabular-nums">{eur(h.base)}</span></div>
          <div className="flex items-baseline justify-between gap-2"><span className="text-muted">Fourchette</span><span className="font-mono tabular-nums">{eurShort(h.low)} – {eurShort(h.high)}</span></div>
          {hover > 0 && <div className="mt-1 flex items-baseline justify-between gap-2 border-t border-line pt-1 text-muted">
            <span>Ce jour</span><span className="font-mono tabular-nums">+{eurShort(h.inflow)} / −{eurShort(h.outflow)}</span>
          </div>}
        </div>
      )}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 rounded-full bg-series-1" />Prévision centrale</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-4 rounded-sm bg-series-1/20" />Fourchette (ventes −25 % / +25 %)</li>
        {showReserve && <li className="flex items-center gap-1.5"><span aria-hidden className="w-4 border-t-2 border-dashed border-[#d95926]" />Réserve de sécurité</li>}
        <li>Du {shortDay(points[0].day)} au {shortDay(last.day)}</li>
      </ul>
    </div>
  );
}
