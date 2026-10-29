import Link from "next/link";
import { Sun } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { dayBrief, type BriefPart } from "@/lib/day-brief";
import type { GoalProgress } from "@/lib/goals";
import type { PriceData } from "@/lib/pricing";

/** « Ma journée »: yesterday and today in one sentence, at the top of the dashboard */
export async function DayBrief({ ship, publish, manager }: { ship: number; publish: number; manager: boolean }) {
  const supabase = await createClient();
  const [progress, prices] = await Promise.all([
    supabase.rpc("goal_progress").then((r) => (r.error ? null : (r.data as GoalProgress))),
    manager ? supabase.rpc("price_suggestions").then((r) => (r.error || !r.data ? 0 : (r.data as PriceData).items.length)) : 0,
  ]);
  const b = dayBrief({ progress, ship, publish, prices, manager });
  return (
    <section aria-label="Ma journée" data-testid="day-brief" className="rise flex gap-3 rounded-2xl border border-line bg-panel/80 px-4 py-3 text-[15px] leading-relaxed">
      <Sun size={20} aria-hidden className="mt-0.5 shrink-0 text-highlight" />
      <p>
        {b.yesterday.length > 0 && <><strong className="font-semibold">Hier :</strong> <Parts parts={b.yesterday} join="," />. </>}
        <strong className="font-semibold">Aujourd&apos;hui :</strong>{" "}
        {b.today.length ? <Parts parts={b.today} join="et" /> : <span className="text-muted">rien d&apos;urgent</span>}.
      </p>
    </section>
  );
}

const TONE = { good: "font-semibold text-emerald-700 dark:text-emerald-400", bad: "font-semibold text-red-600 dark:text-red-400", same: "text-muted" };

function Parts({ parts, join }: { parts: BriefPart[]; join: "," | "et" }) {
  return parts.map((p, i) => {
    const sep = i === 0 ? "" : join === "et" && i === parts.length - 1 ? " et " : ", ";
    const body = p.href
      ? <Link href={p.href} className="font-medium underline decoration-fg/30 underline-offset-4 hover:decoration-fg">{p.text}</Link>
      : <>{p.text && <span className={p.tone ? TONE[p.tone] : undefined}>{p.text}</span>}{p.note && <span className="text-muted">{p.text ? " " : ""}{p.note}</span>}</>;
    return <span key={i} data-part={p.href ?? p.tone ?? "text"}>{sep}{body}</span>;
  });
}

export function DayBriefSkeleton() {
  return <div className="skeleton h-[52px] rounded-2xl" />;
}
