import { getContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageHeader, SkuLink } from "@/components/ui";
import { dateTime, money } from "@/lib/format";
import { NewSale } from "./new-sale";
import { OrderActions } from "./order-actions";

const ORDER_STATUS: Record<string, string> = { pending: "À expédier", shipped: "Expédiée", completed: "Clôturée", cancelled: "Annulée" };

export default async function Sales() {
  const ctx = await getContext();
  const supabase = await createClient();
  const { data: orders } = ctx.isManager
    ? await supabase
        .from("orders")
        .select("*, order_lines(id, status, sale_price_cents, cost_snapshot_cents, items(id, sku)), refunds(amount_cents)")
        .order("sold_at", { ascending: false })
        .limit(100)
    : { data: [] };

  return (
    <>
      <PageHeader title="Ventes" subtitle="Saisissez chaque vente Vinted dès la notification : l'article est retiré du stock vendable." />
      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Card title="Nouvelle vente"><NewSale /></Card>
        {ctx.isManager && (
          <Card title="Commandes">
            {!orders?.length ? (
              <Empty>Aucune vente pour l&apos;instant.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="data">
                  <thead>
                    <tr><th>N°</th><th>Date</th><th>Articles</th><th className="num">Vente</th><th className="num">Frais</th><th className="num">Marge</th><th>Statut</th><th /></tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => {
                      const lines = (o.order_lines ?? []) as { id: string; status: string; sale_price_cents: number; cost_snapshot_cents: number; items: { id: string; sku: string } }[];
                      const refunded = ((o.refunds ?? []) as { amount_cents: number }[]).reduce((s, r) => s + r.amount_cents, 0);
                      const fees = o.platform_fee_cents + o.promotion_fee_cents + o.shipping_cost_cents + o.packaging_cost_cents + o.tax_cents;
                      const cost = lines.filter((l) => l.status !== "cancelled").reduce((s, l) => s + l.cost_snapshot_cents, 0);
                      return (
                        <tr key={o.id} className={o.status === "cancelled" ? "opacity-50" : ""}>
                          <td className="whitespace-nowrap font-mono">V-{o.number}</td>
                          <td className="whitespace-nowrap">{dateTime(o.sold_at)}<div className="text-xs text-muted">{o.buyer_handle}</div></td>
                          <td>{lines.map((l) => <div key={l.id}><SkuLink sku={l.items.sku} />{l.status === "returned" && <span className="text-xs text-rose-600"> retourné</span>}</div>)}</td>
                          <td className="num">{money(o.gross_cents)}{refunded > 0 && <div className="text-xs text-rose-600">-{money(refunded)}</div>}</td>
                          <td className="num">{money(fees)}</td>
                          <td className="num font-semibold">{o.status === "cancelled" ? "—" : money(o.gross_cents - refunded - fees - cost)}</td>
                          <td className="whitespace-nowrap">{ORDER_STATUS[o.status]}{o.paid_at && <div className="text-xs text-muted">encaissé {dateTime(o.paid_at)}</div>}</td>
                          <td><OrderActions orderId={o.id} status={o.status} items={lines.filter((l) => l.status === "active").map((l) => ({ id: l.items.id, sku: l.items.sku }))} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
