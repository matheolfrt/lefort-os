import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { PageHeader } from "@/components/ui";
import { GoalBar } from "@/components/goals/goal-bar";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/errors";
import {
  METRICS, PERIODS, PERIOD_LABEL, formatValue, standing, targets, type GoalMetric, type GoalProgress,
} from "@/lib/goals";
import { GoalsForm } from "./goals-form";

export const metadata = { title: "Objectifs" };

async function saveGoals(fd: FormData) {
  "use server";
  await requireManager();
  const supabase = await createClient();
  const calls = PERIODS.flatMap((period) => METRICS.map((metric) => {
    const raw = String(fd.get(`g_${period}_${metric}`) ?? "").replace(/\s|€/g, "").replace(",", ".");
    const v = raw ? Number(raw) : NaN;
    const target = Number.isFinite(v) && v > 0 ? Math.round(metric === "revenue" ? v * 100 : v) : null;
    return supabase.rpc("set_goal", { p_period: period, p_metric: metric, p_target: target });
  }));
  const failed = (await Promise.all(calls)).find((r) => r.error);
  if (failed?.error) redirect(`/objectifs?erreur=${encodeURIComponent(errorMessage(failed.error))}`);
  revalidatePath("/", "layout");
  redirect("/objectifs?enregistre=1");
}

export default async function Goals({ searchParams }: { searchParams: Promise<{ enregistre?: string; erreur?: string }> }) {
  await requireManager();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("goal_progress");
  if (error || !data) {
    return <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">{error ? errorMessage(error) : "Indisponible."}</p>;
  }
  const p = data as GoalProgress;
  const all = Object.fromEntries(METRICS.map((m) => [m, targets(p, m)])) as Record<GoalMetric, ReturnType<typeof targets>>;
  const any = p.goals.length > 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Objectifs"
        subtitle="Un cap de chiffre d'affaires, de ventes et de mises en ligne pour le jour, la semaine, le mois ou l'année. Suivi en direct sur le tableau de bord." />
      {sp.erreur && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">{sp.erreur}</p>}
      {sp.enregistre && <p role="status" className="rounded-xl bg-accent/10 p-3 text-sm text-accent">Objectifs enregistrés.</p>}

      {any && (
        <section aria-labelledby="where" className="space-y-2">
          <h2 id="where" className="section-title">Où j&apos;en suis</h2>
          <div className="grid gap-2 md:grid-cols-2">
            {PERIODS.map((period) => {
              const list = METRICS.flatMap((m) => { const t = all[m][period]; const s = t ? standing(p, period, m, t) : null; return s ? [s] : []; });
              if (!list.length) return null;
              return (
                <div key={period} data-period={period} className="space-y-3 rounded-2xl border border-line bg-panel/80 p-4">
                  <div className="eyebrow-tight text-muted">{PERIOD_LABEL[period]}</div>
                  {list.map((s) => <GoalBar key={s.metric} s={s} />)}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted">* déduit d&apos;un autre objectif au même rythme. Le trait sur la barre : où il faudrait en être à un rythme régulier.</p>
        </section>
      )}

      <section aria-labelledby="set" className="space-y-2">
        <h2 id="set" className="section-title">{any ? "Mes objectifs" : "Fixer mes objectifs"}</h2>
        <GoalsForm progress={p} action={saveGoals} />
      </section>

      <section aria-labelledby="days" className="space-y-2">
        <h2 id="days" className="section-title">30 derniers jours</h2>
        <div className="grid gap-2 lg:grid-cols-2">
          {(["revenue", "sales"] as GoalMetric[]).map((m) => <DayChart key={m} p={p} metric={m} perDay={all[m].day?.value ?? null} />)}
        </div>
      </section>
    </div>
  );
}

/** Day by day, against the daily objective */
function DayChart({ p, metric, perDay }: { p: GoalProgress; metric: GoalMetric; perDay: number | null }) {
  const vals = p.days.map((d) => (metric === "revenue" ? d.revenue_cents ?? 0 : d[metric]));
  const max = Math.max(1, perDay ?? 0, ...vals);
  const hit = perDay ? vals.filter((v) => v >= perDay).length : null;
  const total = vals.reduce((a, b) => a + b, 0);
  return (
    <div className="rounded-2xl border border-line bg-panel/80 p-4" data-chart={metric}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{metric === "revenue" ? "Chiffre d'affaires" : "Articles vendus"} par jour</span>
        <span className="text-xs text-muted">
          {formatValue(metric, total)} en 30 j{hit != null ? ` · objectif du jour atteint ${hit} fois` : ""}
        </span>
      </div>
      <div className="relative flex h-28 items-end gap-[3px]">
        {perDay != null && (
          <div aria-hidden className="absolute inset-x-0 border-t border-dashed border-highlight/70" style={{ bottom: `${(perDay / max) * 100}%` }}>
            <span className="absolute -top-4 right-0 text-[10px] text-highlight">{formatValue(metric, perDay, true)}/j</span>
          </div>
        )}
        {p.days.map((d, i) => (
          <div key={d.day} title={`${new Date(`${d.day}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} : ${formatValue(metric, vals[i])}`}
            className={`min-w-0 flex-1 rounded-t ${perDay != null && vals[i] >= perDay ? "bg-accent" : "bg-fg/25"}`}
            style={{ height: `${Math.max(vals[i] ? 4 : 1, (vals[i] / max) * 100)}%` }} />
        ))}
      </div>
    </div>
  );
}
