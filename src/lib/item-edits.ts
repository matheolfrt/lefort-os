"use client";

// Quick changes to items (price, location, status, category) and how to undo them.
// Shared by the stock table, the item page and the ⌘K palette, so the rules are the same everywhere.

import { supabaseBrowser } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";
import { rpc } from "@/lib/client-data";
import type { ItemStatus } from "@/lib/types";

interface BulkResult { updated: number; errors: { sku: string; error: string }[] }

/** "29", "29,90", "29.9 €" → cents; null when it is not a price */
export function parsePrice(text: string): number | null {
  const v = Number(text.replace(/\s|€/g, "").replace(",", "."));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
}

/** New asking price; a minimum price above it is cleared (it could no longer be respected) */
export async function setPrice(itemId: string, cents: number | null, minCents?: number | null) {
  const patch: Record<string, number | null> = { list_price_cents: cents };
  if (cents != null && minCents != null && minCents > cents) patch.min_price_cents = null;
  const { error } = await supabaseBrowser().from("items").update(patch).eq("id", itemId);
  if (error) throw new Error(errorMessage(error));
}

/** Moves to a location by its code (A-01-02 or EMP-A-01-02) */
export async function moveTo(itemId: string, code: string) {
  const c = code.trim().toUpperCase();
  await rpc("move_item", { p_item_id: itemId, p_location_code: c.startsWith("EMP-") ? c : `EMP-${c}`, p_method: "manual" });
}

export async function setCategory(itemIds: string[], categoryId: string | null) {
  const { error } = await supabaseBrowser().from("items").update({ category_id: categoryId }).in("id", itemIds);
  if (error) throw new Error(errorMessage(error));
}

/** Brands offered for a change on many items at once (the shop's choice, for now) */
export const BULK_BRANDS = ["Harris Tweed", "Blazer Tweed"];

/** The brand's id in the shop, created if it does not exist yet (any member may add a brand) */
async function brandId(name: string, orgId: string): Promise<string> {
  const sb = supabaseBrowser();
  const { data: found, error } = await sb.from("brands").select("id, name").ilike("name", name.replace(/[%_\\]/g, "\\$&"));
  if (error) throw new Error(errorMessage(error));
  const same = ((found ?? []) as { id: string; name: string }[]).find((b) => b.name.toLowerCase() === name.toLowerCase());
  if (same) return same.id;
  const { data, error: insErr } = await sb.from("brands").insert({ org_id: orgId, name }).select("id").single();
  if (insErr) throw new Error(errorMessage(insErr));
  return data.id;
}

/** The ids really changed (a sold item is only changed by a manager: the others are left as they are) */
export async function setBrand(itemIds: string[], brandName: string, orgId: string): Promise<string[]> {
  const id = await brandId(brandName, orgId);
  const { data, error } = await supabaseBrowser().from("items").update({ brand_id: id }).in("id", itemIds).select("id");
  if (error) throw new Error(errorMessage(error));
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

/** Undo of a brand change: each item gets its brand back (or none) */
export async function restoreBrands(before: { id: string; brandId: string | null }[]) {
  const groups = new Map<string | null, string[]>();
  for (const b of before) groups.set(b.brandId, [...(groups.get(b.brandId) ?? []), b.id]);
  for (const [brand, ids] of groups) {
    const { error } = await supabaseBrowser().from("items").update({ brand_id: brand }).in("id", ids);
    if (error) throw new Error(errorMessage(error));
  }
}

/** Statuses a person may set by hand; sold / shipped / completed / returned go through Ventes */
export const STATUS_TARGETS: { value: ItemStatus | "release"; label: string }[] = [
  { value: "listed", label: "En ligne" },
  { value: "listing_ready", label: "Prêt à publier" },
  { value: "reserved", label: "Réservé" },
  { value: "on_hold", label: "En attente" },
  { value: "release", label: "Reprendre (sortir de l'attente)" },
  { value: "rejected", label: "Écarté" },
  { value: "sorted", label: "Trié (refaire photos)" },
];

/** Changes the status of items; "listed" puts them on sale directly (optionally at a price) */
export async function setStatus(itemIds: string[], target: ItemStatus | "release", opts: { priceCents?: number | null; holdReason?: string } = {}) {
  if (target === "listed") {
    return rpc<BulkResult>("bulk_put_on_sale", { p_item_ids: itemIds, p_price_cents: opts.priceCents ?? null });
  }
  return rpc<BulkResult>("bulk_transition", {
    p_item_ids: itemIds,
    p_to: target === "release" ? null : target,
    p_payload: target === "on_hold" ? { hold_reason: opts.holdReason ?? "other" } : target === "rejected" ? { reason: "Écarté depuis le stock" } : {},
  });
}

/**
 * Puts items back to the status they had. The state machine still applies: an undo it refuses is reported,
 * never forced. Items that were on hold need the step they were at, so they are not undone automatically.
 */
export async function restoreStatuses(before: { id: string; status: ItemStatus }[]): Promise<BulkResult> {
  const groups = new Map<ItemStatus, string[]>();
  for (const b of before) groups.set(b.status, [...(groups.get(b.status) ?? []), b.id]);
  const total: BulkResult = { updated: 0, errors: [] };
  for (const [status, ids] of groups) {
    if (status === "on_hold") { total.errors.push({ sku: `${ids.length} article(s)`, error: "remettez-les en attente à la main" }); continue; }
    const r = await setStatus(ids, status);
    total.updated += r.updated;
    total.errors.push(...r.errors);
  }
  return total;
}

/** Puts items back in the locations they were in (items without one stay where they are) */
export async function restoreLocations(before: { id: string; location: string | null }[]) {
  const groups = new Map<string, string[]>();
  for (const b of before) if (b.location) groups.set(b.location, [...(groups.get(b.location) ?? []), b.id]);
  for (const [code, ids] of groups) await rpc("bulk_move", { p_item_ids: ids, p_location_code: code });
}

export async function restoreCategories(before: { id: string; categoryId: string | null }[]) {
  const groups = new Map<string | null, string[]>();
  for (const b of before) groups.set(b.categoryId, [...(groups.get(b.categoryId) ?? []), b.id]);
  for (const [cat, ids] of groups) await setCategory(ids, cat);
}

/** Undo of a price change: puts back both the asking and the minimum price */
export async function restorePrice(itemId: string, cents: number | null, minCents: number | null) {
  const { error } = await supabaseBrowser().from("items").update({ list_price_cents: cents, min_price_cents: minCents }).eq("id", itemId);
  if (error) throw new Error(errorMessage(error));
}
