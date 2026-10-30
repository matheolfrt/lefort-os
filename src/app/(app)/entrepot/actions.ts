"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_CONFIG } from "@/lib/warehouse3d/config";

/** The first building: the default configuration (200 m², 35 shelves, 4 200 places), then its levels as locations */
export async function createDefaultWarehouse() {
  const ctx = await requireManager();
  const supabase = await createClient();
  const { data, error } = await supabase.from("warehouses")
    .insert({ org_id: ctx.org.id, name: "Entrepôt", config: DEFAULT_CONFIG, is_default: true }).select("id").single();
  if (error) redirect(`/entrepot?error=${encodeURIComponent(error.message)}`);
  const sync = await supabase.rpc("warehouse_sync", { p_warehouse_id: data!.id });
  if (sync.error) redirect(`/entrepot?w=${data!.id}&error=${encodeURIComponent(sync.error.message)}`);
  revalidatePath("/entrepot");
  redirect(`/entrepot?w=${data!.id}`);
}
