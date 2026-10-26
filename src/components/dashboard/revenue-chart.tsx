"use client";

import { useState } from "react";
import { money } from "@/lib/format";

const MONTH = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const label = (key: string) => MONTH[Number(key.slice(5, 7)) - 1];

/** Cash received per month (last 12 months). Single series: one hue, current month emphasised. */
export function RevenueChart({ months }: { months: { month: string; cents: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...months.map((m) => m.cents), 1);
  const W = 600, H = 110, top = 18, bottom = 1, gap = 6;
  const bw = (W - gap * (months.length - 1)) / months.length;
  const plotH = H - top - bottom;
  const active = hover ?? months.length - 1;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Chiffre d'affaires encaissé par mois">
        <line x1="0" x2={W} y1={H - bottom} y2={H - bottom} className="stroke-line" strokeWidth="1" />
        {months.map((m, i) => {
          const h = m.cents > 0 ? Math.max(3, (m.cents / max) * plotH) : 0;
          const x = i * (bw + gap);
          const y = H - bottom - h;
          const current = i === months.length - 1;
          return (
            <g key={m.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(i)}>
              <rect x={x} y={top} width={bw} height={plotH} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x},${H - bottom} V${y + 4} q0,-4 4,-4 H${x + bw - 4} q4,0 4,4 V${H - bottom} Z`}
                  className={current ? "fill-fg" : i === hover ? "fill-fg/60" : "fill-fg/25"}
                />
              )}
            </g>
          );
        })}
      </svg>
      {/* month labels in HTML so they stay readable at every width */}
      <div className="mt-1 grid grid-cols-12 gap-[1%] text-center text-[10px] text-muted">
        {months.map((m, i) => (
          <span key={m.month} className={i === months.length - 1 ? "font-bold text-fg" : i % 2 ? "max-sm:invisible" : ""}>{label(m.month)}</span>
        ))}
      </div>
      <div className="pointer-events-none absolute left-0 top-0 text-xs text-muted">
        <span className="font-semibold text-fg">{label(months[active].month)}</span> · {money(months[active].cents)}
      </div>
    </div>
  );
}
