"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { parseEuros } from "@/lib/format";

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
  // a product spotted can be given right away (the supplier is created even if the link is not valid)
  let note = "";
  if (text(formData, "product_url")) {
    const r = await insertProduct(supabase, data!.id, formData);
    if (r) note = `&error=${encodeURIComponent(r)}`;
  }
  revalidatePath("/fournisseurs");
  redirect(`/fournisseurs/${data!.id}?cree=1${note}`);
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

/** « https://… » even when pasted without it; null when it is not a web address */
function normalizeUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".") ? u.toString() : null;
  } catch { return null; }
}

/** Adds a product spotted at a supplier; returns an error message, or null */
async function insertProduct(supabase: Awaited<ReturnType<typeof createClient>>, supplierId: string, formData: FormData): Promise<string | null> {
  const url = normalizeUrl(String(formData.get("product_url") ?? ""));
  if (!url) return "Le lien du produit n'est pas une adresse web (https://…).";
  const priceRaw = String(formData.get("product_price") ?? "").trim();
  const price = priceRaw ? parseEuros(priceRaw) : null;
  if (priceRaw && price == null) return "Prix du produit invalide.";
  const { error } = await supabase.from("supplier_products").insert({
    supplier_id: supplierId, url, reference: text(formData, "product_ref"), price_cents: price, note: text(formData, "product_note"),
  });
  if (!error) return null;
  return error.code === "42P01" || error.code === "PGRST205" ? "Les produits repérés ont besoin d'une mise à jour de la base." : error.message;
}

export async function addSupplierProduct(supplierId: string, formData: FormData) {
  await requireManager();
  const supabase = await createClient();
  const err = await insertProduct(supabase, supplierId, formData);
  revalidatePath(`/fournisseurs/${supplierId}`);
  redirect(`/fournisseurs/${supplierId}?${err ? `error=${encodeURIComponent(err)}` : "produit=1"}#produits`);
}

export async function deleteSupplierProduct(supplierId: string, id: string) {
  await requireManager();
  const supabase = await createClient();
  const { error } = await supabase.from("supplier_products").delete().eq("id", id);
  revalidatePath(`/fournisseurs/${supplierId}`);
  redirect(`/fournisseurs/${supplierId}?${error ? `error=${encodeURIComponent(error.message)}` : "retire=1"}#produits`);
}

/**
 * Several links at once, one per line; what follows the link on its line is its reference
 * (« https://site.fr/p/12 Blazer Boss 12 »). Lines that are not a web address are reported, the others are kept.
 */
export async function addSupplierProducts(supplierId: string, formData: FormData) {
  await requireManager();
  const supabase = await createClient();
  const lines = String(formData.get("product_lines") ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: { supplier_id: string; url: string; reference: string | null }[] = [];
  const bad: string[] = [];
  for (const line of lines.slice(0, 200)) {
    const [first, ...rest] = line.split(/\s+/);
    const url = normalizeUrl(first);
    if (!url) { bad.push(line.slice(0, 40)); continue; }
    rows.push({ supplier_id: supplierId, url, reference: rest.join(" ").replace(/^[-–—:;]\s*/, "").slice(0, 200) || null });
  }
  let err = !lines.length ? "Collez au moins un lien." : bad.length ? `Pas une adresse web : ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? "…" : ""}` : null;
  if (rows.length) {
    const { error } = await supabase.from("supplier_products").insert(rows);
    if (error) err = error.message;
  }
  revalidatePath(`/fournisseurs/${supplierId}`);
  const ok = rows.length && !err ? `produits=${rows.length}` : rows.length ? `produits=${rows.length}&error=${encodeURIComponent(err!)}` : `error=${encodeURIComponent(err!)}`;
  redirect(`/fournisseurs/${supplierId}?${ok}#produits`);
}
