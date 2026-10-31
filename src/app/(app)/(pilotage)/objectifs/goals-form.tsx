"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { btn } from "@/components/ui";
import {
  METRICS, METRIC_LABEL, PERIODS, PERIOD_NAME, formatValue, suggestions, targets,
  type GoalMetric, type GoalPeriod, type GoalProgress,
} from "@/lib/goals";

const key = (p: GoalPeriod, m: GoalMetric) => `g_${p}_${m}`;
const toInput = (m: GoalMetric, v: number) => (m === "revenue" ? String(Math.round(v / 100)) : String(v));
const fromInput = (m: GoalMetric, s: string): number | null => {
  const v = Number(s.replace(/\s|€/g, "").replace(",", "."));
  if (!s.trim() || !Number.isFinite(v) || v <= 0) return null;
  return m === "revenue" ? Math.round(v * 100) : Math.round(v);
};

/** The objectives grid; an empty box shows the value it gets from the others (same pace), which is what is followed */
export function GoalsForm({ progress, action }: { progress: GoalProgress; action: (fd: FormData) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(progress.goals.map((g) => [key(g.period, g.metric), toInput(g.metric, Number(g.target))])));
  const live: GoalProgress = {
    ...progress,
    goals: PERIODS.flatMap((p) => METRICS.flatMap((m) => {
      const v = fromInput(m, values[key(p, m)] ?? "");
      return v ? [{ period: p, metric: m, target: v }] : [];
    })),
  };
  return (
    <form action={action} className="space-y-3">
      {/* one block per measure: its label and ideas, then one box per period (2 × 2 on a phone, a row on a computer) */}
      <div className="divide-y divide-line rounded-2xl border border-line bg-panel/80">
        {METRICS.map((m) => {
          const t = targets(live, m);
          const ideas = suggestions(progress, "month", m);
          return (
            <div key={m} data-metric={m} className="gap-4 p-4 md:grid md:grid-cols-[minmax(180px,240px)_1fr]">
              <div>
                <div className="font-medium">{METRIC_LABEL[m]}</div>
                <div className="text-xs text-muted">{m === "revenue" ? "en euros, ventes du jour" : m === "sales" ? "articles vendus" : "articles publiés"}</div>
                {ideas.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ideas.map((s) => (
                      <button key={s.label} type="button" title={`Mois : ${s.label}`}
                        onClick={() => setValues((v) => ({ ...v, [key("month", m)]: toInput(m, s.value) }))}
                        className="min-h-9 rounded-lg border border-line px-2.5 text-left text-xs text-muted hover:border-accent/50 hover:text-fg">
                        <span className="font-semibold text-fg/90">{formatValue(m, s.value, true)}/mois</span> · {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 md:mt-0 md:grid-cols-4">
                {PERIODS.map((p) => {
                  const derived = t[p] && !t[p]!.own ? t[p]!.value : null;
                  return (
                    <label key={p} className="block">
                      <span className="eyebrow-tight mb-1 block text-muted">par {PERIOD_NAME[p]}</span>
                      <span className="relative block">
                        <input name={key(p, m)} inputMode={m === "revenue" ? "decimal" : "numeric"} aria-label={`${METRIC_LABEL[m]} par ${PERIOD_NAME[p]}`}
                          value={values[key(p, m)] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [key(p, m)]: e.target.value }))}
                          placeholder={derived != null ? `≈ ${toInput(m, derived)}` : "—"}
                          className={`h-11 w-full rounded-xl border border-line bg-bg/70 px-3 figure tabular-nums outline-none placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/25 ${m === "revenue" ? "pr-7" : ""}`} />
                        {m === "revenue" && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">€</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted">
        Une case vide prend la valeur grisée « ≈ », calculée au même rythme que l&apos;objectif rempli (le mois d&apos;abord) :
        un seul objectif suffit. Videz une case pour retirer l&apos;objectif.
      </p>
      <Save />
    </form>
  );
}

function Save() {
  const { pending } = useFormStatus();
  return <button className={btn.primary} disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer mes objectifs"}</button>;
}
