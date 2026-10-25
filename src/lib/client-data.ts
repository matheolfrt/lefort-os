"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";
import type { Item, ItemPhoto } from "@/lib/types";

export class RpcError extends Error {}

/** Calls a database function; throws RpcError with the French message raised by the database. */
export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseBrowser().rpc(fn, args);
  if (error) throw new RpcError(errorMessage(error));
  return data as T;
}

/** RPCs returning a composite `items` row give back all-null fields when no row matched */
export const asItem = (row: Item | null): Item | null => (row && row.id ? row : null);

export async function loadPhotos(itemId: string): Promise<(ItemPhoto & { url: string })[]> {
  const sb = supabaseBrowser();
  const { data: rows } = await sb.from("item_photos").select("*").eq("item_id", itemId).order("position");
  const data = (rows ?? []) as ItemPhoto[];
  if (!data.length) return [];
  const { data: signed } = await sb.storage.from("item-photos").createSignedUrls(data.map((p: ItemPhoto) => p.storage_path), 3600);
  return data.map((p, i) => ({ ...p, url: signed?.[i]?.signedUrl ?? "" }));
}

export async function loadMeasurements(itemId: string): Promise<Record<string, number>> {
  const { data } = await supabaseBrowser().from("item_measurements").select("definition_id, value_mm").eq("item_id", itemId);
  const rows = (data ?? []) as { definition_id: string; value_mm: number }[];
  return Object.fromEntries(rows.map((m) => [m.definition_id, m.value_mm]));
}
