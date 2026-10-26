import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PERIODS, loadStats, type Period } from "@/lib/stats";
import { LOW_SAMPLE } from "@/lib/dashboard";
import { StatsCharts } from "./stats-charts";

const euro0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur = (cents: number | null) => (cents == null ? "—" : euro0.format(Math.round(cents / 100)));

export default async function Statistiques({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  await requireManager();
  const sp = await searchParams;
  const period = (PERIODS.includes(Number(sp.p) as Period) ? Number(sp.p) : 12) as Period;
  const supabase = await createClient();
  const data = await loadStats(supabase, period);
  const c = data.current, p = data.previous;
  const prevLabel = `vs ${period} mois précédents`;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold leading-tight tracking-[-0.03em] sm:text-[28px]">Statistiques</h1>
          <p className="text-sm text-muted">Toutes les ventes, historiques comprises · {period} derniers mois</p>
        </div>
        <nav aria-label="Période" className="inline-flex rounded-lg border border-line bg-panel p-1">
          {PERIODS.map((n) => (
            <Link key={n} href={`/statistiques?p=${n}`} aria-current={n === period ? "true" : undefined}
              className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium ${n === period ? "bg-fg text-bg" : "text-muted hover:text-fg"}`}>
              {n} mois
            </Link>
          ))}
        </nav>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Chiffre d'affaires" value={eur(c.revenueCents)} delta={change(c.revenueCents, p.revenueCents)} hint={prevLabel} />
        <Kpi label="Marge brute" value={eur(c.profitCents)} delta={change(c.profitCents, p.profitCents)} hint={prevLabel} />
        <Kpi label="Articles vendus" value={String(c.sold)} delta={change(c.sold, p.sold)} hint={prevLabel} />
        <Kpi label="Prix moyen" value={eur(c.avgPriceCents)} delta={change(c.avgPriceCents, p.avgPriceCents)} hint={prevLabel} />
        <Kpi label="Taux de marge" value={c.marginPct == null ? "—" : `${Math.round(c.marginPct)} %`}
          delta={c.marginPct != null && p.marginPct != null ? { text: `${pts(c.marginPct - p.marginPct)} pts`, up: c.marginPct >= p.marginPct } : null}
          hint={prevLabel} />
        <Kpi label="Délai de vente" value={c.avgDays == null ? "—" : `${Math.round(c.avgDays)} j`}
          delta={c.avgDays != null && p.avgDays != null ? { text: `${pts(c.avgDays - p.avgDays)} j`, up: c.avgDays <= p.avgDays } : null}
          hint={c.daysN < LOW_SAMPLE ? `sur ${c.daysN} vente${c.daysN > 1 ? "s" : ""} seulement` : prevLabel} />
      </div>

      <StatsCharts data={data} />
    </div>
  );
}

const pts = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n))}`;

/** Change vs the previous period; null when there is nothing to compare with */
function change(cur: number | null, prev: number | null): { text: string; up: boolean } | null {
  if (cur == null || prev == null || prev === 0) return null;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  return { text: `${pts(pct)} %`, up: pct >= 0 };
}

function Kpi({ label, value, delta, hint }: { label: string; value: string; delta: { text: string; up: boolean } | null; hint: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/80 p-3">
      <div className="eyebrow-tight text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{value}</div>
      <div className="mt-0.5 flex items-center gap-1 text-xs text-muted">
        {delta && (
          <span className={`inline-flex items-center font-semibold ${delta.up ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {delta.up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{delta.text}
          </span>
        )}
        <span className="truncate">{delta ? hint : "pas de comparaison"}</span>
      </div>
    </div>
  );
}

