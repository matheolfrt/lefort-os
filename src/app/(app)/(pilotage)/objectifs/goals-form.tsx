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
      <div className="overflow-x-auto rounded-2xl border border-line bg-panel/80">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="eyebrow-tight px-4 py-3 font-normal">Objectif par…</th>
              {PERIODS.map((p) => <th key={p} className="eyebrow-tight px-2 py-3 font-normal">{PERIOD_NAME[p]}</th>)}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => {
              const t = targets(live, m);
              const ideas = suggestions(progress, "month", m);
              return (
                <tr key={m} className="border-t border-line align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">{METRIC_LABEL[m]}</div>
                    <div className="text-xs text-muted">{m === "revenue" ? "en euros, ventes du jour" : m === "sales" ? "articles vendus" : "articles publiés"}</div>
                    {ideas.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {ideas.map((s) => (
                          <button key={s.label} type="button" title={`Mois : ${s.label}`}
                            onClick={() => setValues((v) => ({ ...v, [key("month", m)]: toInput(m, s.value) }))}
                            className="rounded-lg border border-line px-2 py-1 text-xs text-muted hover:border-accent/50 hover:text-fg">
                            {formatValue(m, s.value, true)}/mois <span className="opacity-70">· {s.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                  {PERIODS.map((p) => {
                    const derived = t[p] && !t[p]!.own ? t[p]!.value : null;
                    return (
                      <td key={p} className="px-2 py-3">
                        <div className="relative">
                          <input name={key(p, m)} inputMode={m === "revenue" ? "decimal" : "numeric"} aria-label={`${METRIC_LABEL[m]} par ${PERIOD_NAME[p]}`}
                            value={values[key(p, m)] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [key(p, m)]: e.target.value }))}
                            placeholder={derived != null ? `≈ ${toInput(m, derived)}` : "—"}
                            className={`h-11 w-full min-w-24 rounded-xl border border-line bg-bg/70 px-3 font-mono tabular-nums outline-none placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/25 ${m === "revenue" ? "pr-7" : ""}`} />
                          {m === "revenue" && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">€</span>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
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
