import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";

// Database updates (supabase/migrations) that came after the first install, and how to tell which are missing.
// Each is detected by a function it creates: called anonymously, a missing function answers "not found" while an
// existing one answers "permission denied" — nothing is run.

interface Migration { file: string; marker: string | null; args: Record<string, unknown>; withNext?: boolean }

export const MIGRATIONS: Migration[] = [
  { file: "20261026000004_vinted_sync", marker: "vinted_sync_preview", args: { p_listings: [] } },
  { file: "20261026000005_bulk_actions", marker: "bulk_transition", args: { p_item_ids: [], p_to: "listed" } },
  // only replaces functions (no new one to detect): due whenever the next one is, and safe to run again
  { file: "20261026000006_vinted_dates", marker: null, args: {}, withNext: true },
  { file: "20261027000007_delete_import", marker: "import_items", args: { p_rows: [] } },
  { file: "20261027000008_import_sales", marker: "import_sales", args: { p_sales: [], p_historical: true } },
  { file: "20261028000009_vinted_orders", marker: "vinted_orders_preview", args: { p_orders: [] } },
  { file: "20261029000010_void_sales", marker: "void_order", args: { p_order_id: "00000000-0000-0000-0000-000000000000" } },
  { file: "20261030000011_batch_skus_on_sale_locations", marker: "bulk_put_on_sale", args: { p_item_ids: [] } },
  { file: "20261031000012_production_board", marker: "production_overview", args: {} },
  { file: "20261101000013_advisor", marker: "advisor_facts", args: {} },
  { file: "20261102000014_niches", marker: "niche_stats", args: {} },
  { file: "20261103000015_sellthrough", marker: "sellthrough_stats", args: {} },
  { file: "20261104000016_goals_todos", marker: "goal_progress", args: {} },
  { file: "20261105000017_suppliers", marker: "supplier_stats", args: {} },
  { file: "20261106000018_price_suggestions", marker: "price_suggestions", args: {} },
  { file: "20261107000019_finance", marker: "finance_overview", args: {} },
  { file: "20261108000020_vinted_reconcile", marker: "vinted_sync_status", args: {} },
  { file: "20261109000021_lot_rotation", marker: "set_listing_started", args: { p_batch_id: "00000000-0000-0000-0000-000000000000" } },
];

const notFound = (code?: string) => code === "PGRST202" || code === "PGRST205" || code === "42883" || code === "42P01";

/** Files still to run, in the order to run them (fresh answer) */
export async function checkPendingMigrations(): Promise<string[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];
  const anon = createClient(url, key, { auth: { persistSession: false } });
  const answers = await Promise.all(MIGRATIONS.map((m) => (m.marker ? anon.rpc(m.marker, m.args) : Promise.resolve(null))));
  const missing = MIGRATIONS.map((m, i) => (m.marker ? notFound(answers[i]?.error?.code) : false));
  MIGRATIONS.forEach((m, i) => { if (m.withNext) missing[i] = missing[i + 1] ?? false; });
  return MIGRATIONS.filter((_, i) => missing[i]).map((m) => m.file);
}

const remembered = unstable_cache(checkPendingMigrations, ["pending-migrations"], { revalidate: 300, tags: ["migrations"] });

/**
 * Same, for the banner shown on every page to managers. "Up to date" is remembered for a few minutes; "something is
 * missing" is checked again each time, so the banner goes away as soon as the update is made.
 */
export async function pendingMigrations(): Promise<string[]> {
  const cached = await remembered();
  return cached.length ? checkPendingMigrations() : cached;
}

/** SQL of a known migration (never an arbitrary path) */
export async function migrationSql(file: string): Promise<string> {
  if (!MIGRATIONS.some((m) => m.file === file)) throw new Error("Mise à jour inconnue.");
  return readFile(path.join(process.cwd(), "supabase", "migrations", `${file}.sql`), "utf8");
}

/** Project reference and SQL editor of the Supabase project the app is connected to */
export function supabaseProject() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  const ref = host.endsWith(".supabase.co") ? host.split(".")[0] : null;
  return { ref, sqlEditor: ref ? `https://supabase.com/dashboard/project/${ref}/sql/new` : null };
}

/**
 * Optional: applies the updates through the Supabase Management API with a personal access token set in Vercel
 * (SUPABASE_ACCESS_TOKEN). Runs them one by one, in order, each in a transaction, and stops at the first error.
 */
export const autoApplyAvailable = () => !!process.env.SUPABASE_ACCESS_TOKEN && !!(process.env.SUPABASE_MANAGEMENT_URL || supabaseProject().ref);

export async function applyMigrations(files: string[]): Promise<{ applied: string[]; error: string | null }> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const { ref } = supabaseProject();
  const api = process.env.SUPABASE_MANAGEMENT_URL ?? "https://api.supabase.com";
  if (!token || !(ref || process.env.SUPABASE_MANAGEMENT_URL)) return { applied: [], error: "Mise à jour automatique non configurée." };
  const applied: string[] = [];
  for (const file of files) {
    const sql = await migrationSql(file);
    const res = await fetch(`${api}/v1/projects/${ref ?? "local"}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: `begin;\n${sql}\ncommit;` }),
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let message = body;
      try { message = (JSON.parse(body) as { message?: string }).message ?? body; } catch { /* plain text */ }
      return { applied, error: `${file}.sql : ${message.slice(0, 400) || `erreur ${res.status}`}` };
    }
    applied.push(file);
  }
  // the API must see the new functions right away
  await fetch(`${api}/v1/projects/${ref ?? "local"}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "notify pgrst, 'reload schema';" }), cache: "no-store",
  }).catch(() => {});
  return { applied, error: null };
}
