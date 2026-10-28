import Link from "next/link";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, PageHeader } from "@/components/ui";
import { euro, pct } from "@/lib/finance";
import { date } from "@/lib/format";

export const metadata = { title: "Ventes · Où est mon argent ?" };

const PER_PAGE = 50;
const PERIODS = [7, 30, 90, 365];

interface Row {
  item_id: string; sku: string; title: string | null; brand: string | null; order_number: string | null; sold_at: string;
  revenue_cents: number; cost_cents: number; variable_cents: number; gross_profit_cents: number;
}
interface Result { total: number; revenue_cents: number; cost_cents: number; variable_cents: number; gross_profit_cents: number; rows: Row[] }

export default async function FinanceSales({ searchParams }: { searchParams: Promise<{ jours?: string; page?: string }> }) {
  await requireManager();
  const sp = await searchParams;
  const jours = Math.min(3650, Math.max(1, Math.round(Number(sp.jours) || 30)));
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_sales", { p_days: jours, p_limit: PER_PAGE, p_offset: (page - 1) * PER_PAGE });
  if (error || !data) {
    return (
      <>
        <PageHeader title="Ventes" back="/finance" />
        <Empty action={{ href: "/parametres/mises-a-jour", label: "Mettre à jour la base" }}>Cette page a besoin d&apos;une mise à jour de la base de données.</Empty>
      </>
    );
  }
  const r = data as Result;
  const pages = Math.max(1, Math.ceil(r.total / PER_PAGE));
  const href = (p: { jours?: number; page?: number }) => `/finance/ventes?jours=${p.jours ?? jours}${(p.page ?? 1) > 1 ? `&page=${p.page}` : ""}`;

  return (
    <div className="space-y-4">
      <PageHeader title={`Ventes des ${jours} derniers jours`} back="/finance"
        subtitle="Les ventes derrière le chiffre d'affaires et la marge. Remboursements déduits ; commandes et lignes annulées exclues." />
      <div className="flex flex-wrap gap-1" aria-label="Période">
        {PERIODS.map((d) => (
          <Link key={d} prefetch={false} href={href({ jours: d })} aria-current={d === jours}
            className={`inline-flex min-h-10 items-center rounded-lg px-3 text-sm ${d === jours ? "bg-accent/15 font-medium text-accent" : "text-muted hover:text-fg"}`}>{d === 365 ? "12 mois" : `${d} j`}</Link>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="sales-totals">
        <Total k={`CA · ${r.total} ventes`} v={euro(r.revenue_cents)} />
        <Total k="Coût d'achat" v={euro(r.cost_cents)} />
        <Total k="Frais, port, TVA" v={euro(r.variable_cents)} />
        <Total k="Marge brute" v={`${euro(r.gross_profit_cents)}`} sub={r.revenue_cents ? `${pct((r.gross_profit_cents * 100) / r.revenue_cents)} du CA` : undefined} />
      </div>
      {r.rows.length ? (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-panel/80">
            <table className="data min-w-[760px]" data-testid="sales">
              <thead><tr><th>Date</th><th>SKU</th><th>Article</th><th>Commande</th><th className="num">CA</th><th className="num">Coût</th><th className="num">Frais</th><th className="num">Marge</th></tr></thead>
              <tbody>
                {r.rows.map((x) => (
                  <tr key={x.item_id}>
                    <td>{date(x.sold_at)}</td>
                    <td><Link prefetch={false} href={`/stock/${encodeURIComponent(x.sku)}`} className="font-mono font-semibold hover:text-accent">{x.sku}</Link></td>
                    <td className="max-w-[16rem] truncate">{[x.brand, x.title].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="font-mono text-xs">{x.order_number ?? "—"}</td>
                    <td className="num">{euro(x.revenue_cents)}</td>
                    <td className="num">{euro(x.cost_cents)}</td>
                    <td className="num">{euro(x.variable_cents)}</td>
                    <td className={`num font-semibold ${x.gross_profit_cents < 0 ? "text-red-300" : ""}`}>{euro(x.gross_profit_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <nav aria-label="Pages" className="flex items-center justify-between gap-2 text-sm">
              {page > 1 ? <Link prefetch={false} href={href({ page: page - 1 })} className="inline-flex min-h-11 items-center text-accent hover:underline">← Plus récentes</Link> : <span />}
              <span className="text-muted">Page {page} sur {pages}</span>
              {page < pages ? <Link prefetch={false} href={href({ page: page + 1 })} className="inline-flex min-h-11 items-center text-accent hover:underline">Plus anciennes →</Link> : <span />}
            </nav>
          )}
        </>
      ) : <Empty>Aucune vente sur cette période.</Empty>}
    </div>
  );
}

function Total({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/80 p-3">
      <div className="eyebrow-tight truncate text-muted">{k}</div>
      <div className="font-mono text-lg font-semibold tabular-nums">{v}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}
