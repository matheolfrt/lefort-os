"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronRight } from "lucide-react";

// Where the capital is: cash, stock (still active), dormant stock, money to receive. Part-to-whole, four parts:
// a ring with a gap between parts, and a legend that carries the names and amounts (colour is never alone).
// Colours: validated categorical slots for the dark surface (aqua, blue, orange, violet).

const COLOR: Record<string, string> = { cash: "#199e70", stock: "#3987e5", dormant: "#d95926", receivable: "#9085e9" };
const eur = (c: number) => `${Math.round(c / 100).toLocaleString("fr-FR")} €`;

export function CapitalMap({ parts, total, cashKnown }: {
  parts: { key: string; label: string; cents: number; share: number; href: string }[]; total: number; cashKnown: boolean;
}) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  const R = 70, W = 22, C = 2 * Math.PI * R, GAP = 2;
  let offset = 0;
  const arcs = parts.filter((p) => p.cents > 0).map((p) => {
    const len = (p.share / 100) * C;
    const a = { ...p, dash: Math.max(0, len - GAP), offset };
    offset += len;
    return a;
  });
  const focus = parts.find((p) => p.key === hover);

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <svg viewBox="0 0 180 180" className="size-44 shrink-0" role="img"
        aria-label={`Répartition du capital : ${parts.map((p) => `${p.label} ${Math.round(p.share)} %`).join(", ")}`}>
        <circle cx="90" cy="90" r={R} fill="none" stroke="var(--line)" strokeWidth={W} />
        {arcs.map((a) => (
          <circle key={a.key} cx="90" cy="90" r={R} fill="none" stroke={COLOR[a.key]} strokeWidth={hover === a.key ? W + 4 : W}
            strokeDasharray={`${a.dash} ${C - a.dash}`} strokeDashoffset={-a.offset} transform="rotate(-90 90 90)"
            opacity={hover && hover !== a.key ? 0.45 : 1} className="cursor-pointer transition-[opacity,stroke-width] duration-150"
            onPointerEnter={() => setHover(a.key)} onPointerLeave={() => setHover(null)} onClick={() => router.push(a.href)} />
        ))}
        <text x="90" y="84" textAnchor="middle" className="fill-muted text-[10px]">{focus ? focus.label : "Capital"}</text>
        <text x="90" y="102" textAnchor="middle" className="fill-fg font-mono text-[15px] font-semibold">{eur(focus ? focus.cents : total)}</text>
        {focus && <text x="90" y="117" textAnchor="middle" className="fill-muted text-[10px]">{Math.round(focus.share)} %</text>}
      </svg>
      <ul className="w-full min-w-0 flex-1 space-y-1">
        {parts.map((p) => (
          <li key={p.key}>
            <Link href={p.href} prefetch={false} data-part={p.key}
              onPointerEnter={() => setHover(p.key)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(p.key)} onBlur={() => setHover(null)}
              className={`group grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-xl px-2 transition ${hover === p.key ? "bg-fg/5" : ""}`}>
              <span aria-hidden className="size-3 rounded-sm" style={{ background: COLOR[p.key] }} />
              <span className="truncate text-sm">{p.label}{p.key === "cash" && !cashKnown && <span className="ml-1 text-xs text-amber-300">non déclarée</span>}</span>
              <span className="text-right font-mono text-sm font-semibold tabular-nums">{eur(p.cents)}</span>
              <span className="flex w-16 items-center justify-end gap-1 text-right font-mono text-xs tabular-nums text-muted">
                {Math.round(p.share)} %<ChevronRight size={14} className="opacity-50 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
