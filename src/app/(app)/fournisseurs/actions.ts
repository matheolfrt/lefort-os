"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;
const taken = (code?: string) => code === "23505";

export async function createSupplier(formData: FormData) {
  const ctx = await requireManager();
  const supabase = await createClient();
  const name = text(formData, "name");
  if (!name) redirect(`/fournisseurs?error=${encodeURIComponent("Donnez un nom au fournisseur.")}`);
  const { data, error } = await supabase.from("suppliers").insert({
    org_id: ctx.org.id, name, country: text(formData, "country"), contact: text(formData, "contact"),
    notes: text(formData, "notes"), created_by: ctx.userId,
  }).select("id").single();
  if (error) redirect(`/fournisseurs?error=${encodeURIComponent(taken(error.code) ? "Ce fournisseur existe déjà." : error.message)}`);
  revalidatePath("/fournisseurs");
  redirect(`/fournisseurs/${data!.id}?cree=1`);
}

/** Name, country, contact and notes; "archive" hides a supplier you no longer buy from (its history stays) */
export async function updateSupplier(id: string, formData: FormData) {
  await requireManager();
  const supabase = await createClient();
  const name = text(formData, "name");
  if (!name) redirect(`/fournisseurs/${id}?error=${encodeURIComponent("Le nom ne peut pas être vide.")}`);
  const { error } = await supabase.from("suppliers").update({
    name, country: text(formData, "country"), contact: text(formData, "contact"), notes: text(formData, "notes"),
  }).eq("id", id);
  if (error) redirect(`/fournisseurs/${id}?error=${encodeURIComponent(taken(error.code) ? "Un autre fournisseur porte déjà ce nom." : error.message)}`);
  revalidatePath("/fournisseurs");
  redirect(`/fournisseurs/${id}?enregistre=1`);
}

export async function setSupplierActive(id: string, active: boolean) {
  await requireManager();
  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").update({ active }).eq("id", id);
  if (error) redirect(`/fournisseurs/${id}?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/fournisseurs");
  redirect(active ? `/fournisseurs/${id}` : "/fournisseurs?archive=1");
}
