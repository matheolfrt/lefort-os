import Link from "next/link";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, PageHeader } from "@/components/ui";
import { euro } from "@/lib/finance";
import { date, daysSince } from "@/lib/format";

export const metadata = { title: "À recevoir · Où est mon argent ?" };

const STATUS: Record<string, string> = { pending: "En attente", shipped: "Expédiée", completed: "Terminée" };

interface Row {
  id: string; number: string | null; sold_at: string; status: string; buyer: string | null;
  gross_cents: number; fees_cents: number; refunded_cents: number; skus: string | null;
}

export default async function Receivables() {
  await requireManager();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_receivables");
  if (error || !data) {
    return (
      <>
        <PageHeader title="À recevoir" back="/finance" />
        <Empty action={{ href: "/parametres/mises-a-jour", label: "Mettre à jour la base" }}>Cette page a besoin d&apos;une mise à jour de la base de données.</Empty>
      </>
    );
  }
  const rows = data as Row[];
  const net = (r: Row) => r.gross_cents - r.fees_cents - r.refunded_cents;
  const total = rows.reduce((a, r) => a + net(r), 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Argent à recevoir" back="/finance"
        subtitle="Ventes sans date d'encaissement : l'argent n'est pas encore sur votre compte. Quand Vinted verse l'argent, clôturez la commande avec sa date de paiement." />
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-line bg-panel/80 p-3">
          <div className="eyebrow-tight text-muted">Total net attendu</div>
          <div className="font-mono text-lg font-semibold tabular-nums" data-testid="receivable-total">{euro(total)}</div>
          <div className="text-xs text-muted">prix − frais − remboursements</div>
        </div>
        <div className="rounded-2xl border border-line bg-panel/80 p-3">
          <div className="eyebrow-tight text-muted">Ventes</div>
          <div className="font-mono text-lg font-semibold tabular-nums">{rows.length}</div>
          <div className="text-xs text-muted">{rows.filter((r) => daysSince(r.sold_at) > 21).length} de plus de 21 jours</div>
        </div>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto rounded-2xl border border-line bg-panel/80">
          <table className="data min-w-[700px]" data-testid="receivables">
            <thead><tr><th>Vendue le</th><th>Commande</th><th>Articles</th><th>Statut</th><th className="num">Prix</th><th className="num">Frais</th><th className="num">Net attendu</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const old = daysSince(r.sold_at) > 21;
                return (
                  <tr key={r.id}>
                    <td className={old ? "text-amber-300" : ""}>{date(r.sold_at)}{old && <span className="ml-1 text-xs">({daysSince(r.sold_at)} j)</span>}</td>
                    <td className="font-mono text-xs">{r.number ?? "—"}{r.buyer && <span className="ml-1 font-sans text-muted">{r.buyer}</span>}</td>
                    <td className="max-w-[14rem] truncate font-mono text-xs">
                      {r.skus ? r.skus.split(", ").map((s, i) => (
                        <span key={s}>{i > 0 && ", "}<Link prefetch={false} href={`/stock/${encodeURIComponent(s)}`} className="hover:text-accent">{s}</Link></span>
                      )) : "—"}
                    </td>
                    <td>{STATUS[r.status] ?? r.status}</td>
                    <td className="num">{euro(r.gross_cents)}</td>
                    <td className="num">{euro(r.fees_cents + r.refunded_cents)}</td>
                    <td className="num font-semibold">{euro(net(r))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty>Tout est encaissé : aucune vente en attente de paiement.</Empty>}
      <p className="text-xs text-muted">
        Les ventes importées comme historiques ne sont jamais comptées ici. Pour enregistrer un paiement, clôturez la commande depuis la page{" "}
        <Link prefetch={false} href="/ventes" className="underline hover:text-fg">Ventes</Link>.
      </p>
    </div>
  );
}
