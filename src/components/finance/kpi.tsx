import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus } from "lucide-react";
import type { Line } from "@/lib/finance/types";
import { Explain } from "./explain";

/** A figure of the command center: value, what it is, how it moved, where it comes from (link) and how it is computed */
export function Kpi({ label, value, sub, delta, href, lines, note, badge, big, id, children }: {
  label: string; value: ReactNode; sub?: ReactNode; delta?: { pct: number | null; text: string; good?: "up" | "down" } | null;
  href?: string; lines?: Line[]; note?: string; badge?: ReactNode; big?: boolean; id?: string; children?: ReactNode;
}) {
  return (
    <div id={id} data-kpi={label} className="flex min-w-0 scroll-mt-24 flex-col rounded-2xl border border-line bg-panel/80 p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="eyebrow-tight text-muted">{label}</span>
        {badge}
      </div>
      {href ? (
        <Link href={href} prefetch={false} className={`group mt-1 inline-flex w-fit items-baseline gap-1 font-mono font-semibold tabular-nums tracking-tight hover:text-accent ${big ? "text-[34px] leading-tight sm:text-[40px]" : "text-[26px] leading-tight"}`}>
          {value}<ChevronRight size={16} className="self-center text-muted transition group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />
        </Link>
      ) : (
        <div className={`mt-1 font-mono font-semibold tabular-nums tracking-tight ${big ? "text-[34px] leading-tight sm:text-[40px]" : "text-[26px] leading-tight"}`}>{value}</div>
      )}
      {delta && <Trend {...delta} />}
      {sub && <div className="mt-0.5 text-xs leading-snug text-muted">{sub}</div>}
      {children}
      {lines && <div className="mt-auto"><Explain lines={lines} note={note} /></div>}
    </div>
  );
}

/** Up or down with an arrow and words: colour is never the only sign */
export function Trend({ pct, text, good = "up" }: { pct: number | null; text: string; good?: "up" | "down" }) {
  if (pct == null) return <div className="mt-0.5 text-xs text-muted">{text}</div>;
  const up = pct > 0.05, down = pct < -0.05;
  const better = (up && good === "up") || (down && good === "down");
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <div className={`mt-0.5 inline-flex flex-wrap items-center gap-x-1 text-xs font-semibold ${!up && !down ? "text-muted" : better ? "text-accent" : "text-red-300"}`}>
      <Icon size={13} aria-hidden /> {up ? "+" : down ? "−" : ""}{Math.abs(pct).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %
      <span className="font-normal text-muted">{text}</span>
    </div>
  );
}

export function LevelBadge({ level }: { level: "faible" | "normal" | "élevé" | "critique" | null }) {
  if (!level) return null;
  const tone = { faible: "bg-sky-400/10 text-sky-300 ring-sky-400/25", normal: "bg-accent/15 text-accent ring-accent/30",
    "élevé": "bg-amber-400/15 text-amber-300 ring-amber-400/30", critique: "bg-red-500/15 text-red-300 ring-red-400/30" }[level];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tone}`}>{level[0].toUpperCase() + level.slice(1)}</span>;
}

export function Section({ id, n, title, aside, children }: { id: string; n: number; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="scroll-mt-20 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
        <h2 id={`${id}-t`} className="flex items-baseline gap-2 text-lg font-semibold tracking-tight">
          <span className="font-mono text-xs text-muted">{String(n).padStart(2, "0")}</span>{title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
