import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * Health check: is the app wired to a Supabase project whose schema is installed?
 * Public on purpose (no data returned, only yes/no answers) so a deploy can be verified before anyone logs in.
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, probleme: "Variables NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY absentes." }, { status: 500 });
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Anonymous callers are refused (42501) when the table/function exists; "not found" errors mean the migrations are missing
  const missing = (code?: string) => code === "PGRST205" || code === "PGRST202" || code === "42P01" || code === "42883";
  const [table, rpc, authHealth] = await Promise.all([
    supabase.from("items").select("id").limit(1),
    supabase.rpc("bootstrap_organization", { p_trade_name: "", p_full_name: "" }),
    fetch(`${url}/auth/v1/health`, { headers: { apikey: key } }).then((r) => r.ok).catch(() => false),
  ]);

  // one function per later migration: tells which files still have to be run in the SQL Editor
  const later = [
    ["20261026000004_vinted_sync", "vinted_sync_preview", { p_listings: [] }],
    ["20261026000005_bulk_actions", "bulk_transition", { p_item_ids: [], p_to: "listed" }],
    ["20261027000007_delete_import", "import_items", { p_rows: [] }],
    ["20261027000008_import_sales", "import_sales", { p_sales: [], p_historical: true }],
    ["20261028000009_vinted_orders", "vinted_orders_preview", { p_orders: [] }],
    ["20261029000010_void_sales", "void_order", { p_order_id: "00000000-0000-0000-0000-000000000000" }],
    ["20261030000011_batch_skus_on_sale_locations", "bulk_put_on_sale", { p_item_ids: [] }],
    ["20261031000012_production_board", "production_overview", {}],
    ["20261101000013_advisor", "advisor_facts", {}],
  ] as const;
  const checks = await Promise.all(later.map(([, fn, args]) => supabase.rpc(fn, args)));
  const toRun = later.filter((_, i) => missing(checks[i].error?.code)).map(([file]) => `${file}.sql`);

  const schema = !missing(table.error?.code) && !missing(rpc.error?.code);
  return NextResponse.json(
    {
      ok: schema && authHealth,
      projet_supabase: new URL(url).hostname.split(".")[0],
      authentification: authHealth ? "ok" : "injoignable",
      migrations: schema ? "installées" : "absentes : exécutez supabase/migrations/*.sql dans ce projet",
      migrations_a_executer: toRun,
      details: { items: table.error?.code ?? "ok", rpc: rpc.error?.code ?? "ok" },
    },
    { status: schema && authHealth ? 200 : 503 },
  );
}
