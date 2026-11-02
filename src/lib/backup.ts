// « Sauvegarde complète »: every table of the shop, read with the signed-in manager's own rights (RLS), packed in one
// ZIP built in the browser (no server size or time limit). Each table is kept twice: JSON (exact values, to restore)
// and CSV (to open in Excel). Photos stay in Supabase Storage: their paths are in item_photos / draft_photos.

import { strToU8, zipSync } from "fflate";
import { toCsv, type Cell } from "@/lib/csv";

/** Table → columns giving a stable order, so that reading 1000 rows at a time neither skips nor repeats a row */
export const BACKUP_TABLES: Record<string, string[]> = {
  organizations: ["id"], profiles: ["id"], memberships: ["id"], tax_rates: ["id"], channels: ["code"],
  suppliers: ["id"], supplier_products: ["id"], brands: ["id"], categories: ["id"], attribute_values: ["id"],
  measurement_templates: ["id"], measurement_definitions: ["id"], shot_lists: ["id"], listing_templates: ["org_id"],
  warehouses: ["id"], floor_plans: ["id"], locations: ["id"],
  batches: ["id"], batch_cost_lines: ["id"], batch_cost_adjustments: ["id"], sku_labels: ["sku"], sku_measures: ["org_id", "sku"],
  items: ["id"], item_costs: ["item_id"], item_photos: ["id"], item_measurements: ["item_id", "definition_id"],
  item_events: ["id"], item_location_moves: ["id"], price_changes: ["id"], price_skips: ["item_id"],
  listings: ["id"], listing_drafts: ["id"], draft_photos: ["id"],
  orders: ["id"], order_lines: ["id"], refunds: ["id"], shipments: ["id"],
  vinted_orders: ["id"], vinted_ignored_orders: ["order_id"], vinted_listings: ["org_id", "external_id"],
  vinted_listing_stats: ["org_id", "external_id", "day"], vinted_sync_runs: ["id"], vinted_sync_events: ["id"],
  expenses: ["id"], recurring_expenses: ["id"], planned_purchases: ["id"], cash_balances: ["id"], capital_snapshots: ["org_id", "day"],
  goals: ["org_id", "period", "metric"], todos: ["id"], notes: ["id"], scenarios: ["id"], niches: ["id"], ai_suggestions: ["id"],
  market_searches: ["id"], market_items: ["search_id", "vinted_id"], market_runs: ["id"],
  audit_log: ["id"],
};

export type Row = Record<string, unknown>;
export interface TableResult { rows: Row[]; error?: string }

/** One cell of the CSV copy: objects and arrays as JSON, the rest as text */
const cell = (v: unknown): Cell => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : (v as Cell));

export function tableCsv(rows: Row[]): string {
  const cols: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  return toCsv([cols, ...rows.map((r) => cols.map((c) => cell(r[c])))]);
}

export interface BackupInfo { at: string; org: string; tables: Record<string, number>; errors: Record<string, string>; total: number }

/** The ZIP: sauvegarde.json (summary), LISEZMOI.txt, json/<table>.json, csv/<table>.csv */
export function buildBackup(results: Record<string, TableResult>, org: string, at = new Date()): { zip: Uint8Array; info: BackupInfo } {
  const files: Record<string, Uint8Array> = {};
  const info: BackupInfo = { at: at.toISOString(), org, tables: {}, errors: {}, total: 0 };
  for (const [table, r] of Object.entries(results)) {
    if (r.error) { info.errors[table] = r.error; continue; }
    info.tables[table] = r.rows.length;
    info.total += r.rows.length;
    files[`json/${table}.json`] = strToU8(JSON.stringify(r.rows));
    files[`csv/${table}.csv`] = strToU8(tableCsv(r.rows));
  }
  files["sauvegarde.json"] = strToU8(JSON.stringify(info, null, 2));
  files["LISEZMOI.txt"] = strToU8(readme(info));
  return { zip: zipSync(files, { level: 6, mtime: at }), info };
}

function readme(info: BackupInfo): string {
  const day = new Date(info.at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
  const lines = Object.entries(info.tables).map(([t, n]) => `  ${t.padEnd(26)} ${n.toLocaleString("fr-FR")} ligne${n > 1 ? "s" : ""}`);
  const errs = Object.entries(info.errors).map(([t, e]) => `  ${t} : ${e}`);
  return [
    `Sauvegarde Lefort OS — ${info.org}`,
    `Faite le ${day} (${info.total.toLocaleString("fr-FR")} lignes).`,
    "",
    "Dossier csv/  : chaque table au format Excel (point-virgule, UTF-8).",
    "Dossier json/ : les mêmes données, valeurs exactes, pour restaurer la base si besoin.",
    "Les photos restent dans Supabase Storage ; leurs chemins sont dans item_photos et draft_photos.",
    "",
    "Contenu :",
    ...lines,
    ...(errs.length ? ["", "Tables non lues (droits ou mise à jour de la base non faite) :", ...errs] : []),
    "",
  ].join("\r\n");
}

/** Days since the last backup made on this device; null when none */
export function daysSince(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / 86_400_000)) : null;
}

/** A backup is due after a week without one */
export const BACKUP_EVERY_DAYS = 7;
export const BACKUP_COOKIE = "lf_backup";
