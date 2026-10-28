"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Money paid for this supplier's lots and money its items brought back, month by month over a year.
// Same unit (euros) on one axis: two bars side by side per month.

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const eur = (c: number) => `${Math.round(c / 100).toLocaleString("fr-FR")} €`;
const short = (c: number) => (c >= 100_000 ? `${Math.round(c / 100_000)} k€` : `${Math.round(c / 100)} €`);
const niceMax = (v: number) => {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p;
};

export function MonthsChart({ months }: { months: { month: string; paid_cents: number; revenue_cents: number; sold: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const W = Math.max(w, 280), H = 170, L = 48, R = 8, T = 10, B = 22;
  const max = niceMax(Math.max(...months.flatMap((m) => [m.paid_cents, m.revenue_cents])));
  const slot = (W - L - R) / months.length;
  const bw = Math.max(3, Math.min(14, (slot - 6) / 2));
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const base = H - B;
  const bar = (x: number, v: number) => {
    const h = v > 0 ? Math.max(3, base - y(v)) : 0, r = Math.min(3, bw / 2, h);
    return h ? `M${x},${base} V${base - h + r} q0,-${r} ${r},-${r} H${x + bw - r} q${r},0 ${r},${r} V${base} Z` : "";
  };
  const m = hover != null ? months[hover] : null;

  return (
    <div ref={ref} className="relative">
      <ul className="mb-2 flex gap-4 text-xs text-muted">
        <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm bg-series-2" /> Achats (lots payés)</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm bg-series-1" /> Ventes de ses articles</li>
      </ul>
      {w > 0 ? (
        <svg width={W} height={H} role="img" className="block"
          aria-label={`Achats et ventes par mois sur 12 mois : ${eur(months.reduce((a, x) => a + x.paid_cents, 0))} payés, ${eur(months.reduce((a, x) => a + x.revenue_cents, 0))} vendus`}>
          {[0, max / 2, max].map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" />
              <text x={L - 6} y={y(v) + 4} textAnchor="end" className="fill-muted text-[10px]">{short(v)}</text>
            </g>
          ))}
          {months.map((mo, i) => {
            const cx = L + i * slot + slot / 2;
            const dim = hover != null && hover !== i;
            return (
              <g key={mo.month} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <rect x={L + i * slot} y={T} width={slot} height={base - T} fill="transparent" />
                <path d={bar(cx - bw - 1, mo.paid_cents)} fill="var(--series-2)" opacity={dim ? 0.45 : 1} />
                <path d={bar(cx + 1, mo.revenue_cents)} fill="var(--series-1)" opacity={dim ? 0.45 : 1} />
                {(i % (W < 420 ? 2 : 1) === 0 || i === months.length - 1) && (
                  <text x={cx} y={H - 6} textAnchor="middle" className={`text-[10px] ${i === months.length - 1 ? "fill-fg font-semibold" : "fill-muted"}`}>
                    {MONTHS[Number(mo.month.slice(5, 7)) - 1]}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      ) : <div style={{ height: H }} />}
      {m && (
        <div role="status" className="pointer-events-none absolute top-6 z-10 w-48 rounded-xl border border-line bg-panel-2/95 p-2.5 text-xs shadow-xl"
          style={{ left: Math.min(Math.max(L + hover! * slot + slot / 2 - 96, 0), Math.max(0, W - 192)) }}>
          <div className="mb-1 text-muted">{MONTHS[Number(m.month.slice(5, 7)) - 1]} {m.month.slice(0, 4)}</div>
          <div className="flex items-center gap-2"><span aria-hidden className="h-0.5 w-3 rounded bg-series-2" /><b className="font-mono">{eur(m.paid_cents)}</b><span className="text-muted">payés</span></div>
          <div className="flex items-center gap-2"><span aria-hidden className="h-0.5 w-3 rounded bg-series-1" /><b className="font-mono">{eur(m.revenue_cents)}</b><span className="text-muted">vendus ({m.sold})</span></div>
        </div>
      )}
    </div>
  );
}
