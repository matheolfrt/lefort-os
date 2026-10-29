"use server";

import { revalidatePath } from "next/cache";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/errors";

// Every decision goes through the database functions of migration 0020: they check, act and write the journal.
// Each action answers { ok, message } for the page to show; the page is then refreshed.

export interface Result { ok: boolean; message: string }

const done = (message: string): Result => {
  revalidatePath("/ventes/vinted");
  revalidatePath("/");
  return { ok: true, message };
};

async function call(fn: string, args: Record<string, unknown>) {
  await requireManager();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(errorMessage(error));
  return data as Record<string, unknown> | null;
}

const MESSAGES: Record<string, string> = {
  linked: "Vente liée", imported: "Vente enregistrée", ignored: "Vente ignorée", cancelled: "Vente annulée dans Lefort OS",
  accepted: "Prix de Lefort OS gardé", replaced: "Prix Vinted appliqué", issue: "Toujours à vérifier", unchanged: "Rien à changer",
  advanced: "Vente mise à jour",
};

export async function resolve(id: string, action: string, args: Record<string, unknown> = {}): Promise<Result> {
  try {
    const r = await call("vinted_resolve", { p_id: id, p_action: action, p_args: args });
    const res = String(r?.result ?? "");
    const number = r?.number ? ` (V-${r.number})` : "";
    return done(`${MESSAGES[res] ?? "C'est fait"}${number}`);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** The seller typed SKUs for the unknown Vinted items: they are looked up, then assigned */
export async function assignBySku(id: string, pairs: { external_id: string; sku?: string; item_id?: string }[]): Promise<Result> {
  try {
    await requireManager();
    const supabase = await createClient();
    const items: { external_id: string; item_id: string }[] = [];
    for (const p of pairs) {
      if (p.item_id) { items.push({ external_id: p.external_id, item_id: p.item_id }); continue; }
      const sku = (p.sku ?? "").trim().toUpperCase();
      if (!sku) return { ok: false, message: "Choisissez un article pour chaque annonce." };
      const { data } = await supabase.from("items").select("id").eq("sku", sku).is("deleted_at", null).maybeSingle();
      if (!data) return { ok: false, message: `${sku} : article introuvable.` };
      items.push({ external_id: p.external_id, item_id: data.id as string });
    }
    const r = await call("vinted_resolve", { p_id: id, p_action: "assign_items", p_args: { items } });
    return r?.issue
      ? done("Articles liés, mais la vente reste à vérifier")
      : done(r?.result === "linked" ? "Articles liés : vente reconnue" : "Articles liés : vente enregistrée");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** Several sales at once (the sales before the start date): stops at the first error */
export async function resolveMany(ids: string[], action: string, args: Record<string, unknown> = {}): Promise<Result> {
  let n = 0;
  for (const id of ids.slice(0, 300)) {
    const r = await resolve(id, action, args);
    if (!r.ok) return { ok: false, message: `${n} traitée(s), puis : ${r.message}` };
    n++;
  }
  return done(`${n} vente(s) traitée(s)`);
}

export async function undo(eventId: string): Promise<Result> {
  try {
    await call("vinted_undo", { p_event: eventId });
    return done("Action annulée");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function linkItem(itemId: string, ref: string): Promise<Result> {
  try {
    await call("vinted_link_item", { p_item_id: itemId, p_ref: ref });
    return done("Annonce liée à l'article");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function setSyncFrom(date: string | null): Promise<Result> {
  try {
    await call("vinted_set_sync_from", { p_date: date || null });
    return done(date ? "Date de début enregistrée" : "Date de début retirée : plus rien n'est enregistré seul");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function ackOrder(orderId: string, undoIt = false): Promise<Result> {
  try {
    await call("vinted_ack_order", { p_order_id: orderId, p_reason: "Vente hors Vinted", p_undo: undoIt });
    return done(undoIt ? "Vente à nouveau surveillée" : "Noté : vente hors Vinted");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
