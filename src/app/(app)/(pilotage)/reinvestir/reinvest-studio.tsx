"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Help, input } from "@/components/ui";
import { FIELDS, type ScenarioInputs } from "@/lib/scenario";
import { HORIZONS, prudent, reinvest, type ReinvestMonth, type ReinvestPlan } from "@/lib/reinvest";
import { MICRO_TURNOVER_CEILING_CENTS } from "@/lib/compliance";
import type { Baseline } from "@/lib/scenario-baseline";

const euro0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur = (v: number) => euro0.format(Math.round(v) || 0); // never "-0 €"
const num = (v: number) => Math.round(v).toLocaleString("fr-FR");
const MONTH = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
const monthName = (ym: string) => MONTH.format(new Date(`${ym}-15T12:00:00Z`));
const SHORT = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });
const horizon = (h: number) => (h === 12 ? "Dans 1 an" : `Dans ${h} mois`);

/** The figures the simulation rests on: the real ones, editable */
const HYPOTHESES: (keyof ScenarioInputs)[] = ["stock", "cost", "price", "sellThrough", "feePct", "feeFixed", "perSale", "urssafPct", "otherFixed", "rent", "capacity"];
const QUICK_NOW = [500, 1000, 2000, 5000];
const QUICK_PCT = [25, 50, 100];

export function ReinvestStudio({ baseline }: { baseline: Baseline }) {
  const [plan, setPlan] = useState<ReinvestPlan>({ now: 1000, monthly: 0, profitPct: 0 });
  const [inputs, setInputs] = useState<ScenarioInputs>(baseline.inputs);
  const r = useMemo(() => reinvest(inputs, plan), [inputs, plan]);
  const low = useMemo(() => reinvest(prudent(inputs), plan), [inputs, plan]);
  const edited = JSON.stringify(inputs) !== JSON.stringify(baseline.inputs);

  const setP = (k: keyof ReinvestPlan, v: string) => {
    const n = Number(v.replace(",", ".").replace(/\s/g, ""));
    setPlan((p) => ({ ...p, [k]: Number.isFinite(n) && n >= 0 ? (k === "profitPct" ? Math.min(100, n) : n) : 0 }));
  };
  const setI = (k: keyof ScenarioInputs, v: string) => {
    const n = Number(v.replace(",", "."));
    setInputs((s) => ({ ...s, [k]: Number.isFinite(n) && n >= 0 ? n : 0 }));
  };

  const at = (list: ReinvestMonth[], h: number) => list[h - 1];
  const nowRevenue = r.base[0]?.revenue ?? 0;
  const year = at(r.months, 12), yearLow = at(low.months, 12);
  const planText = [
    plan.now > 0 && `${eur(plan.now)} maintenant`,
    plan.monthly > 0 && `${eur(plan.monthly)} chaque mois`,
    plan.profitPct > 0 && `${plan.profitPct} % de votre bénéfice chaque mois`,
  ].filter(Boolean) as string[];
  const nothing = !planText.length;
  const team = 1 + Math.max(0, inputs.employees);
  // a share of the profit only reinvests something when there is a profit
  const noProfit = r.months.slice(0, -1).every((m) => m.net <= 0);
  const warnings: string[] = [];
  if (r.peakArrivals > inputs.capacity * team) {
    warnings.push(`Il faudra préparer jusqu'à ${num(r.peakArrivals)} articles par mois (réception, photos, mise en ligne), pour une capacité estimée à ${num(inputs.capacity * team)} : sans aide, une partie du stock attendra et le CA sera plus bas.`);
  }
  if (year && year.revenue * 12 * 100 > MICRO_TURNOVER_CEILING_CENTS) {
    warnings.push("À ce rythme, le CA annuel dépasserait le plafond de la micro-entreprise : passage en société à prévoir.");
  }
  if (year && year.net < 0) warnings.push(`${nothing ? "L'activité est" : "Même avec ce réinvestissement, l'activité resterait"} déficitaire : les charges fixes dépassent la marge des ventes.`);

  return (
    <div className="space-y-5" data-testid="reinvest">
      <header>
        <h1 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">Réinvestir</h1>
        <p className="text-sm text-muted">Si je remets de l&apos;argent dans le stock, combien de chiffre d&apos;affaires par mois dans 3 mois, 6 mois, un an ? Calculé sur vos vrais chiffres.</p>
      </header>

      {/* ── what I reinvest */}
      <section className="rounded-2xl border border-line bg-panel/80 p-4 sm:p-5" aria-labelledby="plan-t">
        <h2 id="plan-t" className="section-title mb-3">Je réinvestis</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Amount label="Maintenant (une fois)" unit="€" value={plan.now} onChange={(v) => setP("now", v)} quick={QUICK_NOW.map((q) => [String(q), eur(q)])} name="now" />
          <Amount label="Chaque mois, en plus" unit="€ / mois" value={plan.monthly} onChange={(v) => setP("monthly", v)} quick={[["0", "0 €"], ["100", "100 €"], ["300", "300 €"]]} name="monthly" />
          <Amount label="Une part de mon bénéfice" unit="% du bénéfice" value={plan.profitPct} onChange={(v) => setP("profitPct", v)} quick={[["0", "0 %"], ...QUICK_PCT.map((q) => [String(q), `${q} %`] as [string, string])]} name="profitPct"
            help="Chaque mois, cette part du bénéfice du mois précédent est remise dans le stock (jamais une part d'une perte). C'est ce qui fait grandir l'activité d'elle-même." />
        </div>
      </section>

      {/* ── the answer in one sentence, then the three horizons */}
      <p className="rounded-2xl bg-accent/10 px-4 py-3 text-[15px] leading-relaxed ring-1 ring-inset ring-accent/25" data-testid="reinvest-summary">
        {nothing
          ? <>Sans réinvestir, votre CA resterait autour de <b>{eur(nowRevenue)} par mois</b>. Indiquez une somme pour voir ce qu&apos;elle changerait.</>
          : <>En réinvestissant {joinFr(planText)}, votre CA passerait de <b>{eur(nowRevenue)}</b> à environ <b>{eur(year.revenue)} par mois dans un an</b>
              {" "}(estimation prudente : {eur(yearLow.revenue)}).
              {" "}Sur l&apos;année : <b>{eur(r.extraNet)}</b> de bénéfice en plus, et le stock acheté en plus est toujours là (<b>{eur(r.extraStockValue)}</b> au prix d&apos;achat, à vendre).</>}
        {plan.profitPct > 0 && noProfit && <span className="mt-1 block text-sm text-amber-800 dark:text-amber-200" data-testid="no-profit">Votre bénéfice mensuel est aujourd&apos;hui négatif ou nul : il n&apos;y a pas encore de bénéfice à réinvestir. Seules les sommes ajoutées comptent.</span>}
      </p>

      <div className="grid gap-3 md:grid-cols-3" data-testid="horizons">
        {HORIZONS.map((h) => {
          const m = at(r.months, h), b = at(r.base, h), l = at(low.months, h);
          const gain = b.revenue > 0 ? (m.revenue - b.revenue) / b.revenue : null;
          return (
            <div key={h} className="rounded-2xl border border-line bg-panel/80 p-4" data-horizon={h}>
              <div className="text-sm font-medium text-muted">{horizon(h)} <span className="text-muted/70">· {monthName(m.month)}</span></div>
              <div className="mt-1 font-mono text-[30px] font-semibold leading-tight tabular-nums tracking-tight">{eur(m.revenue)}<span className="text-base font-medium text-muted"> / mois</span></div>
              <div className="text-xs text-muted">de CA · prudent : {eur(l.revenue)}</div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-line pt-2 text-sm">
                <dt className="text-muted">Sans réinvestir</dt><dd className="text-right font-mono tabular-nums">{eur(b.revenue)}</dd>
                <dt className="text-muted">Différence</dt>
                <dd className={`text-right font-mono tabular-nums ${m.revenue > b.revenue + 0.5 ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
                  {m.revenue > b.revenue + 0.5 ? "↑ +" : ""}{eur(m.revenue - b.revenue)}{gain != null && gain > 0.005 ? ` (+${Math.round(gain * 100)} %)` : ""}
                </dd>
                <dt className="text-muted">Bénéfice du mois</dt><dd className={`text-right font-mono tabular-nums ${m.net < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{eur(m.net)}</dd>
                <dt className="text-muted">Stock en vente</dt><dd className="text-right font-mono tabular-nums">{num(m.stock)} art.</dd>
              </dl>
            </div>
          );
        })}
      </div>

      {warnings.length > 0 && (
        <ul className="space-y-2" data-testid="reinvest-warnings">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-2 rounded-xl bg-amber-400/10 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-400/30 dark:text-amber-200">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {w}
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-2xl border border-line bg-panel/80 p-4 sm:p-5" aria-labelledby="curve-t">
        <h2 id="curve-t" className="section-title mb-2">CA par mois sur un an</h2>
        <Curve months={r.months.map((m) => m.month)} lines={[
          { label: "En réinvestissant", values: r.months.map((m) => m.revenue), cls: "stroke-series-1", dot: "bg-series-1" },
          { label: "Estimation prudente", values: low.months.map((m) => m.revenue), cls: "stroke-series-1 opacity-50 [stroke-dasharray:6_4]", dot: "bg-series-1/50" },
          { label: "Sans réinvestir", values: r.base.map((m) => m.revenue), cls: "stroke-muted [stroke-dasharray:2_4]", dot: "bg-muted" },
        ]} />
        <details className="mt-3">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-muted hover:text-fg">Mois par mois</summary>
          <div className="overflow-x-auto">
            <table className="data" data-testid="reinvest-table">
              <thead><tr><th>Mois</th><th className="num">Stock en vente</th><th className="num">Ventes</th><th className="num">CA</th><th className="num">Bénéfice</th><th className="num">Réinvesti</th><th className="num">CA sans réinvestir</th></tr></thead>
              <tbody>
                {r.months.map((m, i) => (
                  <tr key={m.month}>
                    <td>{monthName(m.month)}</td><td className="num">{num(m.stock)}</td><td className="num">{num(m.sales)}</td>
                    <td className="num">{eur(m.revenue)}</td><td className="num">{eur(m.net)}</td><td className="num">{eur(m.invested)}</td><td className="num">{eur(r.base[i].revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {/* ── what it rests on, editable */}
      <section className="rounded-2xl border border-line bg-panel/80 p-4 sm:p-5" aria-labelledby="hyp-t">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="hyp-t" className="section-title">Sur quoi repose le calcul</h2>
          {edited && <button className="min-h-11 text-sm font-medium text-series-1 hover:underline" onClick={() => setInputs(baseline.inputs)}>Revenir à mes vrais chiffres</button>}
        </div>
        <p className="mb-3 text-sm text-muted">Vos chiffres réels ({baseline.basis.join(" · ")}). Chaque mois, la même part du stock se vend ; ce qui se vend est racheté ; l&apos;argent réinvesti achète du stock en plus, au même coût, en vente le mois suivant. <b className="font-medium text-fg">La vue prudente</b> compte 25 % de ventes en moins et des prix 5 % plus bas : avec beaucoup plus de stock, l&apos;écoulement peut baisser.</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {HYPOTHESES.map((k) => {
            const f = FIELDS.find((x) => x.key === k)!;
            return (
              <label key={k} className="block text-sm">
                <span className="mb-1 block text-muted">{f.label} <span className="text-muted/60">({f.unit})</span></span>
                <input className={`${input} text-right font-mono tabular-nums`} type="number" inputMode="decimal" step={f.step ?? 1} min={0}
                  value={inputs[k]} onChange={(e) => setI(k, e.target.value)} name={`h-${k}`} />
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Amount({ label, unit, value, onChange, quick, help, name }: {
  label: string; unit: string; value: number; onChange: (v: string) => void; quick: [string, string][]; help?: string; name: string;
}) {
  return (
    <div>
      <label className="block">
        <span className="mb-1 flex items-center gap-1 text-sm font-medium">{label}{help && <Help text={help} />}</span>
        <span className="relative block">
          <input className={`${input} pr-28 text-right font-mono text-lg tabular-nums`} inputMode="decimal" name={name}
            value={value ? String(value).replace(".", ",") : ""} placeholder="0" onChange={(e) => onChange(e.target.value)} />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">{unit}</span>
        </span>
      </label>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {quick.map(([v, l]) => (
          <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={String(value) === v}
            className={`min-h-11 rounded-full px-3 text-sm ring-1 ring-inset transition ${String(value) === v ? "bg-accent/15 text-accent ring-accent/30" : "text-muted ring-line hover:text-fg"}`}>{l}</button>
        ))}
      </div>
    </div>
  );
}

/** A few lines over the 12 months; the table under it gives every value */
function Curve({ months, lines }: { months: string[]; lines: { label: string; values: number[]; cls: string; dot: string }[] }) {
  const W = 600, H = 200, P = 6;
  const max = Math.max(1, ...lines.flatMap((l) => l.values)) * 1.08;
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, months.length - 1);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const first = lines[0].values[0] ?? 0, last = lines[0].values.at(-1) ?? 0;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full sm:h-56" role="img" preserveAspectRatio="none"
        aria-label={`CA par mois en réinvestissant : de ${eur(first)} à ${eur(last)} en 12 mois ; sans réinvestir : ${eur(lines.at(-1)!.values[0] ?? 0)}`}>
        {[0.25, 0.5, 0.75, 1].map((t) => <line key={t} x1={0} x2={W} y1={y(max * t / 1.08)} y2={y(max * t / 1.08)} className="stroke-line" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
        {lines.map((l) => (
          <path key={l.label} d={l.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("")} fill="none"
            className={l.cls} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        {months.map((m, i) => <span key={m} className={i % 2 ? "hidden sm:inline" : ""}>{SHORT.format(new Date(`${m}-15T12:00:00Z`))}</span>)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {lines.map((l) => <span key={l.label} className="inline-flex items-center gap-1.5"><span className={`h-1 w-4 rounded ${l.dot}`} /> {l.label}</span>)}
      </div>
    </div>
  );
}

function joinFr(xs: string[]) {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} et ${xs.at(-1)}`;
}
