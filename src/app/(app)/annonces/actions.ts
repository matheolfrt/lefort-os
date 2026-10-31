"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/errors";
import { aiEnabled, aiError, writeWithClaude } from "@/lib/drafts/ai";
import {
  DEFAULT_DESCRIPTION, DEFAULT_TITLE, descriptionFields, fieldsOf, fillTemplate, fillTitle, splitMeasures, type DraftContext,
} from "@/lib/drafts/text";

type Res<T = object> = ({ error: null } & T) | { error: string };
const PATH = "/annonces";
const fail = (e: unknown) => ({ error: errorMessage(e) });
const cleanSku = (s: string) => s.trim().replace(/\s+/g, "");

/** A new article from photos of the pile (or none), with its SKU */
export async function createDraft(sku: string, photoIds: string[]): Promise<Res<{ id: string; inStock: boolean }>> {
  await getContext();
  const s = cleanSku(sku);
  if (!s) return { error: "Indiquez le SKU de l'article." };
  if (s.length > 64) return { error: "SKU trop long." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("listing_drafts").insert({ sku: s }).select("id, item_id").single();
  if (error) return /duplicate/i.test(error.message) ? { error: `Le SKU ${s} a déjà un article : ajoutez-y les photos.` } : fail(error);
  const moved = await movePhotos(data.id, photoIds);
  if (moved) return { error: moved };
  revalidatePath(PATH);
  return { error: null, id: data.id, inStock: Boolean(data.item_id) };
}

/** photos into an article, after its own (in the order given) */
async function movePhotos(draftId: string, photoIds: string[]): Promise<string | null> {
  if (!photoIds.length) return null;
  const supabase = await createClient();
  const { data: last } = await supabase.from("draft_photos").select("position").eq("draft_id", draftId).order("position", { ascending: false }).limit(1);
  const start = (last?.[0]?.position ?? -1) + 1;
  for (let i = 0; i < photoIds.length; i++) {
    const { error } = await supabase.from("draft_photos").update({ draft_id: draftId, position: start + i }).eq("id", photoIds[i]);
    if (error) return errorMessage(error);
  }
  return null;
}

export async function addPhotos(draftId: string, photoIds: string[]): Promise<Res> {
  await getContext();
  const e = await movePhotos(draftId, photoIds);
  if (e) return { error: e };
  revalidatePath(PATH);
  return { error: null };
}

/** back to the pile */
export async function unassignPhoto(photoId: string): Promise<Res> {
  await getContext();
  const supabase = await createClient();
  const { error } = await supabase.from("draft_photos").update({ draft_id: null, position: Math.floor(Date.now() / 1000) }).eq("id", photoId);
  if (error) return fail(error);
  revalidatePath(PATH);
  return { error: null };
}

/** the first photo is the one Vinted shows in the lists */
export async function makeCover(photoId: string): Promise<Res> {
  await getContext();
  const supabase = await createClient();
  const { data: p, error } = await supabase.from("draft_photos").select("draft_id").eq("id", photoId).single();
  if (error || !p?.draft_id) return fail(error ?? { message: "Photo introuvable." });
  const { data: all } = await supabase.from("draft_photos").select("id").eq("draft_id", p.draft_id).order("position");
  const order = [photoId, ...(all ?? []).map((x) => x.id).filter((id) => id !== photoId)];
  for (let i = 0; i < order.length; i++) await supabase.from("draft_photos").update({ position: i }).eq("id", order[i]);
  revalidatePath(PATH);
  return { error: null };
}

/** photos deleted for good (the file too) */
export async function deletePhotos(photoIds: string[]): Promise<Res> {
  await getContext();
  if (!photoIds.length) return { error: null };
  const supabase = await createClient();
  const { data, error } = await supabase.from("draft_photos").select("id, storage_path").in("id", photoIds);
  if (error) return fail(error);
  const { error: delErr } = await supabase.from("draft_photos").delete().in("id", photoIds);
  if (delErr) return fail(delErr);
  if (data?.length) await supabase.storage.from("item-photos").remove(data.map((p) => p.storage_path));
  revalidatePath(PATH);
  return { error: null };
}

export async function updateDraft(id: string, patch: { sku?: string; measures?: string; title?: string; description?: string; price_cents?: number | null; status?: string }): Promise<Res> {
  await getContext();
  const row: Record<string, unknown> = {};
  if (patch.sku !== undefined) { const s = cleanSku(patch.sku); if (!s) return { error: "Le SKU ne peut pas être vide." }; row.sku = s; }
  if (patch.measures !== undefined) row.measures = patch.measures.slice(0, 5000);
  if (patch.title !== undefined) row.title = patch.title.replace(/\s+/g, " ").trim().slice(0, 200);
  if (patch.description !== undefined) row.description = patch.description.slice(0, 10000);
  if (patch.price_cents !== undefined) row.price_cents = patch.price_cents && patch.price_cents > 0 ? Math.round(patch.price_cents) : null;
  if (patch.status !== undefined) {
    if (!["a_faire", "genere", "pret"].includes(patch.status)) return { error: "État inconnu." };
    row.status = patch.status;
  }
  const supabase = await createClient();
  const { error } = await supabase.from("listing_drafts").update(row).eq("id", id);
  if (error) return /duplicate/i.test(error.message) ? { error: "Un autre article a déjà ce SKU." } : fail(error);
  revalidatePath(PATH);
  return { error: null };
}

/** the article goes; its photos go back to the pile */
export async function deleteDraft(id: string): Promise<Res> {
  await getContext();
  const supabase = await createClient();
  const { error } = await supabase.from("listing_drafts").delete().eq("id", id);
  if (error) return fail(error);
  revalidatePath(PATH);
  return { error: null };
}

/** Measurements pasted for many SKUs: each article gets its block. Nothing is written for a SKU without article. */
export async function applyMeasures(text: string): Promise<Res<{ applied: string[]; missing: string[]; orphan: number }>> {
  await getContext();
  const supabase = await createClient();
  const { data: drafts, error } = await supabase.from("listing_drafts").select("id, sku");
  if (error) return fail(error);
  const split = splitMeasures(text, (drafts ?? []).map((d) => d.sku));
  const applied: string[] = [];
  for (const d of drafts ?? []) {
    const block = split.blocks.get(d.sku);
    if (block === undefined) continue;
    const { error: e } = await supabase.from("listing_drafts").update({ measures: block.slice(0, 5000) }).eq("id", d.id);
    if (e) return fail(e);
    applied.push(d.sku);
  }
  revalidatePath(PATH);
  return { error: null, applied, missing: (drafts ?? []).map((d) => d.sku).filter((s) => !split.blocks.has(s)), orphan: split.orphan.length };
}

export async function saveTemplate(t: { title_template: string; description_template: string; instructions: string }): Promise<Res> {
  const ctx = await getContext();
  const supabase = await createClient();
  const row = { title_template: t.title_template.slice(0, 500), description_template: t.description_template.slice(0, 10000),
    instructions: t.instructions.slice(0, 5000), updated_by: ctx.userId };
  // one model per shop: changed if it exists, else created (the shop itself never changes)
  const { data: done, error } = await supabase.from("listing_templates").update(row).eq("org_id", ctx.org.id).select("org_id");
  if (error) return fail(error);
  if (!done?.length) {
    const { error: insErr } = await supabase.from("listing_templates").insert({ org_id: ctx.org.id, ...row });
    if (insErr) return fail(insErr);
  }
  revalidatePath(PATH);
  return { error: null };
}

const MAX_AI_PHOTOS = 8;

/**
 * Title and description of one article: with AI from its photos when the key is set (and asked), else the model
 * filled with the stock's data and the measurements. Never overwrites an article marked « prête ».
 */
export async function generate(id: string, mode: "ia" | "modele"): Promise<Res<{ title: string; description: string; by: "ia" | "modele"; to_check: string[] }>> {
  await getContext();
  const supabase = await createClient();
  const [{ data: d, error }, { data: tpl }, ctxRes] = await Promise.all([
    supabase.from("listing_drafts").select("id, sku, measures, price_cents, status").eq("id", id).single(),
    supabase.from("listing_templates").select("title_template, description_template, instructions").maybeSingle(),
    supabase.rpc("listing_draft_context", { p_id: id }),
  ]);
  if (error || !d) return fail(error ?? { message: "Article introuvable." });
  if (d.status === "pret" || d.status === "envoye") return { error: `${d.sku} est marqué prêt : repassez-le « à revoir » pour le régénérer.` };
  if (ctxRes.error) return fail(ctxRes.error);
  const ctx = (ctxRes.data ?? { sku: d.sku, item: null }) as DraftContext;
  const titleT = tpl?.title_template?.trim() || DEFAULT_TITLE;
  const descT = tpl?.description_template?.trim() || DEFAULT_DESCRIPTION;
  const fields = fieldsOf(ctx, d.measures ?? "", d.price_cents);

  let out: { title: string; description: string; to_check: string[] };
  let by: "ia" | "modele" = "modele";
  if (mode === "ia" && aiEnabled()) {
    const { data: photos } = await supabase.from("draft_photos").select("storage_path").eq("draft_id", id).order("position").limit(MAX_AI_PHOTOS);
    if (!photos?.length) return { error: `${d.sku} n'a pas de photo : l'IA a besoin des photos.` };
    const images: { data: string; mediaType: "image/jpeg" }[] = [];
    for (const p of photos) {
      const { data: blob, error: dlErr } = await supabase.storage.from("item-photos").download(p.storage_path);
      if (dlErr || !blob) return { error: `Photo illisible pour ${d.sku}.` };
      images.push({ data: Buffer.from(await blob.arrayBuffer()).toString("base64"), mediaType: "image/jpeg" });
    }
    const known: Record<string, string> = {};
    for (const k of ["categorie", "marque", "taille", "etat", "couleur", "motif", "matiere", "defauts", "prix"]) if (fields[k]) known[k] = String(fields[k]);
    try {
      out = await writeWithClaude({ photos: images, sku: d.sku, measures: String(fields.mesures ?? ""), known, titleTemplate: titleT,
        descriptionTemplate: descT, instructions: tpl?.instructions ?? "" });
      by = "ia";
    } catch (e) {
      return { error: `${d.sku} : ${aiError(e)}` };
    }
  } else {
    out = { title: fillTitle(titleT, fields), description: fillTemplate(descT, descriptionFields(fields)), to_check: [] };
    if (!ctx.item) out.to_check.push("Pas dans le stock : le modèle n'a que le SKU et vos mesures.");
    if (!out.title) out.to_check.push("Titre vide : aucun mot du titre type n'est connu pour cet article, écrivez-le.");
  }
  const { error: upErr } = await supabase.from("listing_drafts").update({
    title: out.title.slice(0, 200), description: out.description.slice(0, 10000), status: "genere", generated_by: by,
    generated_at: new Date().toISOString(), to_check: out.to_check,
  }).eq("id", id);
  if (upErr) return fail(upErr);
  revalidatePath(PATH);
  return { error: null, ...out, by };
}
