import Link from "next/link";
import { ChevronRight, Target } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { METRICS, PERIOD_LABEL, standing, targets, type GoalPeriod, type GoalProgress } from "@/lib/goals";
import { GoalBar } from "./goal-bar";

/** Today and this month against the objectives, on the dashboard */
export async function GoalsCard({ isManager }: { isManager: boolean }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("goal_progress");
  if (error || !data) return null;
  const p = data as GoalProgress;
  const byMetric = METRICS.map((m) => ({ metric: m, t: targets(p, m) }));
  const rows = (["day", "month"] as GoalPeriod[]).map((period) => ({
    period,
    items: byMetric.flatMap(({ metric, t }) => {
      const target = t[period];
      const s = target ? standing(p, period, metric, target) : null;
      return s ? [s] : [];
    }),
  })).filter((r) => r.items.length);

  if (!rows.length) {
    if (!isManager) return null;
    return (
      <Link href="/objectifs" data-testid="goals-empty"
        className="flex items-center gap-3 rounded-2xl border border-dashed border-line bg-panel/40 px-4 py-3 text-sm text-muted transition hover:border-fg/30 hover:text-fg">
        <Target size={20} className="shrink-0 text-accent" />
        <span className="flex-1">Fixez-vous un objectif de chiffre d&apos;affaires ou de ventes pour le jour, la semaine ou le mois.</span>
        <ChevronRight size={18} />
      </Link>
    );
  }
  const derived = rows.some((r) => r.items.some((s) => !s.target.own));
  return (
    <section data-testid="dashboard-goals">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="eyebrow text-muted">Objectifs</h2>
        {isManager && (
          <Link href="/objectifs" className="-my-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-series-1 hover:underline">
            Modifier <ChevronRight size={16} />
          </Link>
        )}
      </div>
      <div className={`grid gap-2 ${rows.length > 1 ? "md:grid-cols-2" : ""}`}>
        {rows.map((r) => (
          <div key={r.period} className="space-y-3 rounded-2xl border border-line bg-panel/80 p-4">
            <div className="eyebrow-tight text-muted">{PERIOD_LABEL[r.period]}</div>
            {r.items.map((s) => <GoalBar key={s.metric} s={s} />)}
          </div>
        ))}
      </div>
      {derived && <p className="mt-1 text-xs text-muted">* déduit de votre objectif sur une autre période, au même rythme.</p>}
    </section>
  );
}

export function GoalsSkeleton() {
  return <div className="skeleton h-40 rounded-2xl" />;
}
