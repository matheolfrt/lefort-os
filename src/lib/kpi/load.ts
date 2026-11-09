import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemStatus } from "@/lib/types";
import type { KpiItem, KpiOrder, LotFees } from "./compute";

// Indicateurs — reads what the page needs, one row per item and per order, the lots and their cost lines, and the
// expenses of the last 90 days. Everything is computed afterwards in compute.ts.

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

type ItemRow = {
  id: string; sku: string; status: ItemStatus; title: string | null; size_label: string | null; list_price_cents: number | null;
  received_at: string | null; listed_at: string | null; sold_at: string | null; brand_id: string | null; category_id: string | null; batch_id: string;
};
type EcoRow = { item_id: string; is_sold: boolean; revenue_cents: number | string; gross_profit_cents: number | string; cost_cents: number | string };
type BatchRow = { id: string; code: string; kind: string | null; purchased_at: string | null; supplier_id: string | null };
type OrderRow = { id: string; sold_at: string; buyer_handle: string | null; gross_cents: number | string };

export interface KpiData { items: KpiItem[]; orders: KpiOrder[]; lots: LotFees[]; expenses: { spentOn: string; cents: number }[] }

export async function loadKpi(supabase: SupabaseClient, now = Date.now()): Promise<KpiData> {
  const since = new Date(now - 400 * 86_400_000).toISOString();
  const since90 = new Date(now - 95 * 86_400_000).toISOString().slice(0, 10);
  const [items, eco, batches, lines, suppliers, brands, categories, orders, orderLines, expenses] = await Promise.all([
    fetchAll<ItemRow>((a, b) => supabase.from("items")
      .select("id, sku, status, title, size_label, list_price_cents, received_at, listed_at, sold_at, brand_id, category_id, batch_id")
      .is("deleted_at", null).order("id").range(a, b)),
    fetchAll<EcoRow>((a, b) => supabase.from("v_item_economics")
      .select("item_id, is_sold, revenue_cents, gross_profit_cents, cost_cents").order("item_id").range(a, b)),
    fetchAll<BatchRow>((a, b) => supabase.from("batches").select("id, code, kind, purchased_at, supplier_id").order("id").range(a, b)),
    fetchAll<{ batch_id: string; kind: string }>((a, b) => supabase.from("batch_cost_lines").select("batch_id, kind").order("id").range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from("suppliers").select("id, name").order("id").range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from("brands").select("id, name").order("id").range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from("categories").select("id, name").order("id").range(a, b)),
    fetchAll<OrderRow>((a, b) => supabase.from("orders").select("id, sold_at, buyer_handle, gross_cents")
      .neq("status", "cancelled").gte("sold_at", since).order("id").range(a, b)),
    fetchAll<{ order_id: string }>((a, b) => supabase.from("order_lines").select("order_id").eq("status", "active").order("id").range(a, b)),
    fetchAll<{ spent_on: string; amount_cents: number | string }>((a, b) => supabase.from("expenses").select("spent_on, amount_cents")
      .gte("spent_on", since90).order("id").range(a, b)),
  ]);

  const ecoBy = new Map(eco.map((e) => [e.item_id, e]));
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const brandName = new Map(brands.map((b) => [b.id, b.name]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const batchBy = new Map(batches.map((b) => [b.id, b]));
  const kinds = new Map<string, string[]>();
  for (const l of lines) kinds.set(l.batch_id, [...(kinds.get(l.batch_id) ?? []), l.kind]);
  const perOrder = new Map<string, number>();
  for (const l of orderLines) perOrder.set(l.order_id, (perOrder.get(l.order_id) ?? 0) + 1);

  return {
    items: items.map((i) => {
      const e = ecoBy.get(i.id), b = batchBy.get(i.batch_id);
      return {
        id: i.id, sku: i.sku, status: i.status, title: i.title, sizeLabel: i.size_label,
        brand: i.brand_id ? brandName.get(i.brand_id) ?? null : null, category: i.category_id ? categoryName.get(i.category_id) ?? null : null,
        listPrice: i.list_price_cents == null ? null : Number(i.list_price_cents),
        receivedAt: i.received_at, listedAt: i.listed_at, soldAt: i.sold_at,
        isSold: Boolean(e?.is_sold), revenue: Number(e?.revenue_cents ?? 0), profit: Number(e?.gross_profit_cents ?? 0), cost: Number(e?.cost_cents ?? 0),
        batchId: i.batch_id, batchCode: b?.code ?? null, batchKind: b?.kind ?? "purchase",
        supplier: b?.supplier_id ? supplierName.get(b.supplier_id) ?? null : null, purchasedAt: b?.purchased_at ?? null,
      };
    }),
    orders: orders.map((o) => ({ id: o.id, soldAt: o.sold_at, buyer: o.buyer_handle, gross: Number(o.gross_cents), items: perOrder.get(o.id) ?? 1 })),
    lots: batches.map((b) => ({ id: b.id, code: b.code, kind: b.kind ?? "purchase", purchasedAt: b.purchased_at, lineKinds: kinds.get(b.id) ?? [] })),
    expenses: expenses.map((e) => ({ spentOn: e.spent_on, cents: Number(e.amount_cents) })),
  };
}
