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
              <>
                {/* Phone: one card per order */}
                <ul className="space-y-2 md:hidden">
                  {orders.map((o) => {
                    const r = summarise(o);
                    return (
                      <li key={o.id} className={`rounded-xl border border-line p-3 ${o.status === "cancelled" ? "opacity-50" : ""}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-bold">V-{o.number}</span>
                          <OrderBadge status={o.status} />
                        </div>
                        <div className="text-xs text-muted">{dateTime(o.sold_at)}{o.buyer_handle && ` · ${o.buyer_handle}`}</div>
                        <div className="mt-1 flex flex-wrap gap-x-3">
                          {r.lines.map((l) => <span key={l.id} className="inline-flex items-center [&>a]:inline-flex [&>a]:min-h-10 [&>a]:items-center"><SkuLink sku={l.items.sku} />{l.status === "returned" && <span className="text-xs text-rose-600"> retourné</span>}</span>)}
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 border-t border-line pt-2 text-sm">
                          <div><div className="text-[10px] font-semibold uppercase text-muted">Vente</div><div className="tabular-nums">{money(o.gross_cents)}</div></div>
                          <div><div className="text-[10px] font-semibold uppercase text-muted">Frais</div><div className="tabular-nums">{money(r.fees)}</div></div>
                          <div><div className="text-[10px] font-semibold uppercase text-muted">Marge</div><div className={`font-semibold tabular-nums ${r.margin != null && r.margin < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{r.margin == null ? "—" : money(r.margin)}</div></div>
                        </div>
                        <div className="mt-2 flex justify-end">
                          <OrderActions orderId={o.id} status={o.status} items={r.lines.filter((l) => l.status === "active").map((l) => ({ id: l.items.id, sku: l.items.sku }))} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="-mx-4 -mb-4 hidden overflow-x-auto md:block">
                  <table className="data">
                    <thead>
                      <tr><th>N°</th><th>Date</th><th>Articles</th><th className="num">Vente</th><th className="num">Frais</th><th className="num">Marge</th><th>Statut</th><th /></tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => {
                        const r = summarise(o);
                        return (
                          <tr key={o.id} className={o.status === "cancelled" ? "opacity-50" : ""}>
                            <td className="whitespace-nowrap font-mono font-semibold">V-{o.number}</td>
                            <td className="whitespace-nowrap">{dateTime(o.sold_at)}<div className="text-xs text-muted">{o.buyer_handle}</div></td>
                            <td>{r.lines.map((l) => <div key={l.id}><SkuLink sku={l.items.sku} />{l.status === "returned" && <span className="text-xs text-rose-600"> retourné</span>}</div>)}</td>
                            <td className="num">{money(o.gross_cents)}{r.refunded > 0 && <div className="text-xs text-rose-600">-{money(r.refunded)}</div>}</td>
                            <td className="num">{money(r.fees)}</td>
                            <td className={`num font-semibold ${r.margin != null && r.margin < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{r.margin == null ? "—" : money(r.margin)}</td>
                            <td className="whitespace-nowrap"><OrderBadge status={o.status} />{o.paid_at && <div className="mt-0.5 text-xs text-muted">encaissé {dateTime(o.paid_at)}</div>}</td>
                            <td><OrderActions orderId={o.id} status={o.status} items={r.lines.filter((l) => l.status === "active").map((l) => ({ id: l.items.id, sku: l.items.sku }))} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        )}
      </div>
    </>
  );
}

type OrderRow = {
  status: string; gross_cents: number; platform_fee_cents: number; promotion_fee_cents: number;
  shipping_cost_cents: number; packaging_cost_cents: number; tax_cents: number;
  order_lines: unknown; refunds: unknown;
};

/** Money of one order: refunds, all fees, and margin after the items' cost */
function summarise(o: OrderRow) {
  const lines = (o.order_lines ?? []) as { id: string; status: string; sale_price_cents: number; cost_snapshot_cents: number; items: { id: string; sku: string } }[];
  const refunded = ((o.refunds ?? []) as { amount_cents: number }[]).reduce((s, r) => s + r.amount_cents, 0);
  const fees = o.platform_fee_cents + o.promotion_fee_cents + o.shipping_cost_cents + o.packaging_cost_cents + o.tax_cents;
  const cost = lines.filter((l) => l.status !== "cancelled").reduce((s, l) => s + l.cost_snapshot_cents, 0);
  return { lines, refunded, fees, margin: o.status === "cancelled" ? null : o.gross_cents - refunded - fees - cost };
}

const ORDER_TONE: Record<string, string> = {
  pending: "bg-orange-300 text-orange-950",
  shipped: "bg-lime-200 text-lime-950",
  completed: "bg-zinc-300 text-zinc-800",
  cancelled: "bg-line text-muted",
};

function OrderBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${ORDER_TONE[status]}`}>
      {ORDER_STATUS[status]}
    </span>
  );
}
