import { getContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Download, Search, Upload } from "lucide-react";
import { Card, Empty, PageHeader, SkuLink, btn, input } from "@/components/ui";
import { dateTime, money } from "@/lib/format";
import { NewSale } from "./new-sale";
import { OrderActions } from "./order-actions";

const ORDER_STATUS: Record<string, string> = { pending: "À expédier", shipped: "Expédiée", completed: "Clôturée", cancelled: "Annulée" };

const PAGE = 50;
const FILTERS: { key: string; label: string }[] = [
  { key: "", label: "Toutes" }, { key: "pending", label: "À expédier" }, { key: "shipped", label: "Expédiées" },
  { key: "completed", label: "Clôturées" }, { key: "cancelled", label: "Annulées" },
];
type Params = { q?: string; etat?: string; page?: string; article?: string; nouvelle?: string };

export default async function Sales({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const supabase = await createClient();
  const page = Math.max(Number(sp.page) || 1, 1);
  const etat = FILTERS.some((f) => f.key === sp.etat) ? sp.etat ?? "" : "";
  const q = (sp.q ?? "").replace(/[%,()*]/g, " ").trim();

  let orders: Awaited<ReturnType<typeof loadOrders>>["data"] = [];
  let count = 0;
  const counts: Record<string, number> = {};
  async function loadOrders() {
    let query = supabase.from("orders")
      .select("*, order_lines(id, status, sale_price_cents, cost_snapshot_cents, items(id, sku)), refunds(amount_cents)", { count: "exact" });
    if (etat) query = query.eq("status", etat);
    if (q) {
      // V-123 or 123 → order number; otherwise buyer, Vinted reference, or an item's SKU / title
      const num = q.match(/^v?-?(\d+)$/i)?.[1];
      const { data: items } = await supabase.from("items").select("id").or(`sku.ilike.%${q}%,title.ilike.%${q}%`).limit(100);
      const { data: lines } = items?.length
        ? await supabase.from("order_lines").select("order_id").in("item_id", items.map((i) => i.id)).limit(150)
        : { data: [] as { order_id: string }[] };
      const ids = [...new Set((lines ?? []).map((l) => l.order_id))];
      query = query.or([
        `buyer_handle.ilike.%${q}%`, `external_order_id.ilike.%${q}%`,
        ...(num ? [`number.eq.${num}`] : []), ...(ids.length ? [`id.in.(${ids.join(",")})`] : []),
      ].join(","));
    }
    return query.order("sold_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  }
  if (ctx.isManager) {
    const [res, ...byStatus] = await Promise.all([
      loadOrders(),
      ...FILTERS.slice(1).map((f) => supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", f.key)),
    ]);
    orders = res.data ?? [];
    count = res.count ?? 0;
    FILTERS.slice(1).forEach((f, i) => { counts[f.key] = byStatus[i].count ?? 0; });
    counts[""] = Object.values(counts).reduce((a, b) => a + b, 0);
  }
  const pages = Math.max(1, Math.ceil(count / PAGE));
  const href = (patch: Partial<Params>) => {
    const next = { q: sp.q, etat: etat || undefined, page: undefined, ...patch } as Record<string, string | undefined>;
    const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]);
    return `/ventes${qs.size ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Ventes"
        subtitle="Saisissez chaque vente Vinted dès la notification : l'article est retiré du stock vendable."
        actions={ctx.isManager && (
          <>
            <a href="/export/ventes" className={btn.secondary}><Download size={16} /> Exporter CSV</a>
            <Link href="/ventes/import" className={btn.secondary}><Upload size={16} /> Importer</Link>
          </>
        )}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Card title="Nouvelle vente"><NewSale initialSku={sp.article ?? null} focus={sp.nouvelle === "1"} defaultPackagingCents={ctx.org.packaging_cost_cents ?? null} /></Card>
        {ctx.isManager && (
          <Card title={`Commandes · ${count}`}>
            <div className="mb-3 space-y-2">
              <form action="/ventes" className="relative">
                {etat && <input type="hidden" name="etat" value={etat} />}
                <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input className={`${input} pl-10`} name="q" defaultValue={sp.q} placeholder="N° de vente, acheteur, SKU, titre…" aria-label="Rechercher une vente" />
              </form>
              <nav aria-label="Filtrer par état" className="-mx-4 overflow-x-auto px-4">
                <ul className="flex min-w-max gap-1.5">
                  {FILTERS.map((f) => (
                    <li key={f.key}>
                      <Link href={href({ etat: f.key || undefined })} aria-current={etat === f.key ? "true" : undefined}
                        className={`inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-medium transition ${
                          etat === f.key ? "border-fg bg-fg text-bg" : "border-line bg-panel hover:border-fg/30"}`}>
                        {f.label}<span className={`tabular-nums ${etat === f.key ? "opacity-70" : "text-muted"}`}>{counts[f.key] ?? 0}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
            {!orders?.length ? (
              <Empty action={q || etat ? { href: "/ventes", label: "Voir toutes les ventes" } : undefined}
                secondary={q || etat ? undefined : { href: "/ventes/import", label: "Importer mes ventes" }}>
                {q || etat ? "Aucune vente ne correspond." : "Aucune vente pour l'instant : enregistrez la première avec le formulaire, ou importez l'historique de Vinted."}
              </Empty>
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
                          <OrderBadge status={o.status} historical={o.is_historical} />
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
                            <td className="whitespace-nowrap"><OrderBadge status={o.status} historical={o.is_historical} />{o.paid_at && <div className="mt-0.5 text-xs text-muted">encaissé {dateTime(o.paid_at)}</div>}</td>
                            <td className="w-10"><OrderActions compact orderId={o.id} status={o.status} items={r.lines.filter((l) => l.status === "active").map((l) => ({ id: l.items.id, sku: l.items.sku }))} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {pages > 1 && (
                  <nav className="mt-4 flex items-center justify-center gap-2 text-sm" aria-label="Pagination">
                    {page > 1 && <Link href={href({ page: String(page - 1) })} className={btn.secondary}>← Précédent</Link>}
                    <span className="px-2 tabular-nums text-muted">Page {page} / {pages}</span>
                    {page < pages && <Link href={href({ page: String(page + 1) })} className={btn.secondary}>Suivant →</Link>}
                  </nav>
                )}
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
  pending: "bg-blue-400/15 text-blue-200 ring-1 ring-inset ring-blue-400/30",
  shipped: "bg-sky-400/15 text-sky-200 ring-1 ring-inset ring-sky-400/30",
  completed: "bg-zinc-400/15 text-zinc-300 ring-1 ring-inset ring-zinc-400/30",
  cancelled: "bg-fg/5 text-muted ring-1 ring-inset ring-line",
};

function OrderBadge({ status, historical }: { status: string; historical?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${ORDER_TONE[status]}`}>
        {ORDER_STATUS[status]}
      </span>
      {historical && (
        <span title="Déjà déclarée ailleurs : hors livre des recettes" className="inline-flex items-center rounded-full border border-line px-2 py-0.5 text-xs font-medium text-muted">
          historique
        </span>
      )}
    </span>
  );
}
