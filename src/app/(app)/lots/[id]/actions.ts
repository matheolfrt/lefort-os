"use server";

import { revalidatePath } from "next/cache";
import { requireManager, getContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { parseEuros } from "@/lib/format";
import { errorMessage } from "@/lib/errors";

export type ActionResult = { error?: string; skus?: string[] };

export async function issueLabels(batchId: string, qty: number): Promise<ActionResult> {
  await getContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_sku_labels", { p_batch_id: batchId, p_qty: qty });
  if (error) return { error: errorMessage(error) };
  revalidatePath(`/lots/${batchId}`);
  return { skus: data as string[] };
}

export async function addCostLine(batchId: string, formData: FormData): Promise<void> {
  const ctx = await requireManager();
  const supabase = await createClient();
  const amount = parseEuros(String(formData.get("amount") ?? ""));
  if (!amount) return;
  await supabase.from("batch_cost_lines").insert({
    org_id: ctx.org.id, batch_id: batchId, kind: String(formData.get("kind")), amount_cents: amount,
    description: String(formData.get("description") || "") || null, created_by: ctx.userId,
  });
  revalidatePath(`/lots/${batchId}`);
}

export async function deleteCostLine(batchId: string, lineId: string): Promise<void> {
  await requireManager();
  const supabase = await createClient();
  await supabase.from("batch_cost_lines").delete().eq("id", lineId);
  revalidatePath(`/lots/${batchId}`);
}

export async function addAdjustment(batchId: string, formData: FormData): Promise<void> {
  const ctx = await requireManager();
  const supabase = await createClient();
  const amount = parseEuros(String(formData.get("amount") ?? "").replace("-", ""));
  const sign = String(formData.get("amount") ?? "").trim().startsWith("-") ? -1 : 1;
  if (!amount) return;
  await supabase.from("batch_cost_adjustments").insert({
    org_id: ctx.org.id, batch_id: batchId, amount_cents: sign * amount,
    reason: String(formData.get("reason") || "Ajustement"), created_by: ctx.userId,
  });
  revalidatePath(`/lots/${batchId}`);
}

export async function setAllocation(batchId: string, method: string): Promise<void> {
  await requireManager();
  const supabase = await createClient();
  await supabase.from("batches").update({ allocation_method: method }).eq("id", batchId);
  revalidatePath(`/lots/${batchId}`);
}

export async function closeBatch(batchId: string): Promise<ActionResult> {
  await requireManager();
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_batch", { p_batch_id: batchId });
  revalidatePath(`/lots/${batchId}`);
  return error ? { error: errorMessage(error) } : {};
}
