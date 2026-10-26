import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { csvEuros, toCsv, type Cell } from "@/lib/csv";

const ORDER_STATUS: Record<string, string> = { pending: "À expédier", shipped: "Expédiée", completed: "Clôturée", cancelled: "Annulée" };
const LINE_STATUS: Record<string, string> = { active: "Vendu", cancelled: "Annulé", returned: "Retourné" };

type Line = {
  sale_price_cents: number; cost_snapshot_cents: number; status: string;
  items: { sku: string; title: string | null; brands: { name: string } | null; categories: { name: string } | null } | null;
  orders: {
    number: number; channel: string; external_order_id: string | null; buyer_handle: string | null; sold_at: string;
    paid_at: string | null; status: string; gross_cents: number; platform_fee_cents: number; promotion_fee_cents: number;
    shipping_cost_cents: number; packaging_cost_cents: number; tax_cents: number; is_historical: boolean;
  };
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : "");

// GET /export/ventes?year=2026 — one line per item sold. Managers only (orders are hidden from operators by RLS).
export async function GET(request: NextRequest) {
  const year = Number(request.nextUrl.searchParams.get("year")) || null;
  const supabase = await createClient();
  const lines: Line[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from("order_lines").select(`sale_price_cents, cost_snapshot_cents, status,
      items(sku, title, brands(name), categories(name)),
      orders!inner(number, channel, external_order_id, buyer_handle, sold_at, paid_at, status, is_historical, gross_cents,
        platform_fee_cents, promotion_fee_cents, shipping_cost_cents, packaging_cost_cents, tax_cents)`);
    if (year) q = q.gte("orders.sold_at", `${year}-01-01`).lt("orders.sold_at", `${year + 1}-01-01`);
    const { data, error } = await q.range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    lines.push(...(data as unknown as Line[]));
    if ((data ?? []).length < 1000) break;
  }
  lines.sort((a, b) => b.orders.sold_at.localeCompare(a.orders.sold_at));

  const header = ["N° commande", "Date de vente", "Date d'encaissement", "Statut commande", "Statut article", "SKU", "Titre",
    "Marque", "Catégorie", "Prix de vente", "Frais", "Coût", "Marge", "Acheteur", "Réf commande", "Canal", "Historique"];
  const body: Cell[][] = lines.map((l) => {
    const o = l.orders;
    const fees = o.platform_fee_cents + o.promotion_fee_cents + o.shipping_cost_cents + o.packaging_cost_cents + o.tax_cents;
    // order fees are shared between its items in proportion to their price
    const share = o.gross_cents > 0 ? Math.round((fees * l.sale_price_cents) / o.gross_cents) : 0;
    const counted = o.status !== "cancelled" && l.status === "active";
    return [
      `V-${o.number}`, day(o.sold_at), day(o.paid_at), ORDER_STATUS[o.status], LINE_STATUS[l.status], l.items?.sku, l.items?.title,
      l.items?.brands?.name, l.items?.categories?.name, csvEuros(l.sale_price_cents), csvEuros(share), csvEuros(l.cost_snapshot_cents),
      counted ? csvEuros(l.sale_price_cents - share - l.cost_snapshot_cents) : "", o.buyer_handle, o.external_order_id, o.channel, o.is_historical ? "oui" : "",
    ];
  });

  return new NextResponse(toCsv([header, ...body]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ventes${year ? `-${year}` : ""}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
