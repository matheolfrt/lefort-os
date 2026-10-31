import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { VERDICT, type Judged } from "@/lib/suppliers";

const eur = (cents: number | null) => (cents == null ? "—" : `${Math.round(cents / 100).toLocaleString("fr-FR")} €`);
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v)} %`);
const ago = (day: string | null) => {
  if (!day) return null;
  const d = Math.round((Date.now() - new Date(`${day}T12:00:00Z`).getTime()) / 86_400_000);
  return d <= 0 ? "aujourd'hui" : d < 60 ? `il y a ${d} j` : `il y a ${Math.round(d / 30)} mois`;
};

export function VerdictChip({ v }: { v: Judged["verdict"] }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${VERDICT[v].tone}`}>{VERDICT[v].label}</span>;
}

/** How much of what was paid has come back, and what is still in stock to sell */
export function Payback({ s }: { s: Judged }) {
  // the stock from before Lefort OS has estimated costs: "paid back 600 %" would mean nothing
  if (s.paybackPct == null || s.opening_only) return null;
  const back = Math.min(100, Math.max(0, s.paybackPct));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted">Remboursé</span>
        <span className="figure font-semibold tabular-nums">{pct(s.paybackPct)}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-fg/10" role="progressbar" aria-label={`${pct(s.paybackPct)} de ce qui a été payé est revenu`}
        aria-valuenow={Math.round(back)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${s.paybackPct >= 100 ? "bg-accent" : "bg-series-1/70"}`} style={{ width: `${back}%` }} />
      </div>
      <div className="mt-1 text-[11px] text-muted">
        {eur(s.revenue_cents - s.variable_cents)} revenus sur {eur(s.paid_cents)} payés
        {s.in_stock > 0 && ` · ${s.in_stock} en stock (${eur(s.stock_cost_cents)} d'achat)`}
      </div>
    </div>
  );
}

export function SupplierCard({ s, target, products = 0 }: { s: Judged; target: number; products?: number }) {
  return (
    <Link href={`/fournisseurs/${s.id}`} data-supplier={s.name}
      className="group flex flex-col gap-3 rounded-2xl border border-line bg-panel/80 p-4 transition hover:border-fg/25">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[17px] font-semibold">{s.name}</div>
          <div className="truncate text-xs text-muted">
            {[s.country, `${s.batches} lot${s.batches > 1 ? "s" : ""}`, s.last_purchase && `dernier achat ${ago(s.last_purchase)}`,
              products > 0 && `${products} produit${products > 1 ? "s" : ""} repéré${products > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1"><VerdictChip v={s.verdict} /><ChevronRight size={16} className="text-muted transition group-hover:translate-x-0.5" /></div>
      </div>
      <p className="text-sm text-fg/80">{s.reasons[0]}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <Fig k="Marge / vendu" v={eur(s.marginPerSold)} />
        <Fig k="Achat → vente" v={s.costPerItem != null && s.avgSale != null ? `${eur(s.costPerItem)} → ${eur(s.avgSale)}` : eur(s.costPerItem)}
          hint={s.multiple != null ? `× ${s.multiple.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}` : undefined} />
        <Fig k="Vendu en 30 j" v={pct(s.sellThroughPct)} hint={s.sellThroughPct != null ? `objectif ${target} %` : "pas encore"} />
        <Fig k="Délai de vente" v={s.avg_days != null ? `${Math.round(s.avg_days)} j` : "—"} hint={s.rejected ? `${s.rejected} écarté${s.rejected > 1 ? "s" : ""} (${pct(s.rejectPct)})` : "aucun écarté"} />
      </dl>
      <Payback s={s} />
    </Link>
  );
}

function Fig({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow-tight truncate text-muted">{k}</dt>
      <dd className="truncate figure font-semibold tabular-nums">{v}</dd>
      {hint && <dd className="truncate text-xs text-muted">{hint}</dd>}
    </div>
  );
}
