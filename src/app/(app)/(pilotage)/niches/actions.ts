"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { parseEuros, parisToday } from "@/lib/format";
import { LIBRARY, type NicheStatus } from "@/lib/niches";

const list = (v: FormDataEntryValue | null) =>
  String(v ?? "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
const uniq = <T,>(a: T[]) => [...new Set(a)];
const euros = (v: FormDataEntryValue | null) => (String(v ?? "").trim() ? parseEuros(String(v)) : null);

function fail(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
}

/** Creates or updates a niche from the form (brand_ids / category_ids arrive as repeated fields) */
export async function saveNiche(formData: FormData) {
  const ctx = await requireManager();
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "") || null;
  const back = id ? `/niches/${id}` : "/niches/nouvelle";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) fail(back, "Donnez un nom à la niche.");
  const row = {
    name,
    hypothesis: String(formData.get("hypothesis") ?? "").trim() || null,
    brand_ids: uniq(formData.getAll("brand_ids").map(String).filter(Boolean)),
    category_ids: uniq(formData.getAll("category_ids").map(String).filter(Boolean)),
    sizes: uniq(list(formData.get("sizes")).map((s) => s.toUpperCase())),
    keywords: uniq(list(formData.get("keywords")).map((s) => s.toLowerCase())),
    price_min_cents: euros(formData.get("price_min")),
    price_max_cents: euros(formData.get("price_max")),
    target_buy_cents: euros(formData.get("target_buy")),
    target_sell_cents: euros(formData.get("target_sell")),
    budget_cents: euros(formData.get("budget")),
    test_items: Number(formData.get("test_items")) || null,
  };
  if (row.price_min_cents != null && row.price_max_cents != null && row.price_min_cents > row.price_max_cents) {
    fail(back, "Le prix minimum dépasse le prix maximum.");
  }
  const query = id
    ? supabase.from("niches").update(row).eq("id", id).select("id").single()
    : supabase.from("niches").insert({ ...row, org_id: ctx.org.id, created_by: ctx.userId }).select("id").single();
  const { data, error } = await query;
  if (error) fail(back, error.code === "23505" ? "Une niche porte déjà ce nom." : error.message);
  revalidatePath("/niches");
  redirect(`/niches/${data.id}?ok=1`);
}

/** Turns an idea (library or suggestion) into a niche: names are matched to the brands and categories that exist */
export async function createFromIdea(formData: FormData) {
  const ctx = await requireManager();
  const supabase = await createClient();
  const raw = String(formData.get("idea") ?? "");
  let idea: { name: string; hypothesis?: string; brands?: string[]; categories?: string[]; sizes?: string[]; keywords?: string[]; price_min_cents?: number; price_max_cents?: number };
  try {
    idea = LIBRARY.find((l) => l.key === raw) ?? JSON.parse(raw);
  } catch {
    fail("/niches", "Idée introuvable.");
  }
  const [{ data: brands }, { data: categories }] = await Promise.all([
    supabase.from("brands").select("id, name"),
    supabase.from("categories").select("id, name").eq("active", true),
  ]);
  const find = <T extends { id: string; name: string }>(rows: T[] | null, name: string) =>
    (rows ?? []).find((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase());
  const brandIds: string[] = [];
  const keywords = [...(idea.keywords ?? [])];
  for (const b of idea.brands ?? []) {
    const hit = find(brands, b);
    // a brand never seen yet still matches the titles that mention it
    if (hit) brandIds.push(hit.id); else keywords.push(b.toLowerCase());
  }
  const categoryIds = (idea.categories ?? []).map((c) => find(categories, c)?.id).filter((x): x is string => !!x);
  // a brand-only idea with keywords would need both: keep brands OR keywords meaningful by not mixing them
  const useKeywordsOnly = brandIds.length > 0 && keywords.length > 0;
  const { data, error } = await supabase.from("niches").insert({
    org_id: ctx.org.id, created_by: ctx.userId, name: idea.name, hypothesis: idea.hypothesis ?? null,
    brand_ids: useKeywordsOnly ? [] : brandIds,
    keywords: uniq(useKeywordsOnly ? [...keywords, ...(idea.brands ?? []).map((b) => b.toLowerCase())] : keywords),
    category_ids: categoryIds, sizes: idea.sizes ?? [],
    price_min_cents: idea.price_min_cents ?? null, price_max_cents: idea.price_max_cents ?? null,
  }).select("id").single();
  if (error) fail("/niches", error.code === "23505" ? `La niche « ${idea.name} » existe déjà.` : error.message);
  revalidatePath("/niches");
  redirect(`/niches/${data.id}`);
}

/** `status` is bound by the button (decide.bind(null, "validated")) or sent as a hidden field */
export async function decide(bound: NicheStatus | null, formData: FormData) {
  await requireManager();
  const supabase = await createClient();
  const id = String(formData.get("id"));
  const status = (bound ?? String(formData.get("status"))) as NicheStatus;
  if (!["idea", "testing", "validated", "dropped"].includes(status)) fail(`/niches/${id}`, "Statut inconnu.");
  const note = String(formData.get("note") ?? "").trim() || null;
  const today = parisToday();
  const { data: cur } = await supabase.from("niches").select("started_at").eq("id", id).single();
  const patch: Record<string, unknown> = { status };
  if (status === "testing") { patch.started_at = cur?.started_at ?? today; patch.decided_at = null; }
  if (status === "validated" || status === "dropped") { patch.decided_at = today; patch.decision_note = note; }
  if (status === "idea") { patch.started_at = null; patch.decided_at = null; }
  const { error } = await supabase.from("niches").update(patch).eq("id", id);
  if (error) fail(`/niches/${id}`, error.message);
  revalidatePath("/niches");
  redirect(`/niches/${id}`);
}

export async function deleteNiche(formData: FormData) {
  await requireManager();
  const supabase = await createClient();
  const id = String(formData.get("id"));
  const { error } = await supabase.from("niches").delete().eq("id", id);
  if (error) fail(`/niches/${id}`, error.message);
  revalidatePath("/niches");
  redirect("/niches");
}

/** A batch bought to test the niche: all its items count in the test */
export async function linkBatch(formData: FormData) {
  await requireManager();
  const supabase = await createClient();
  const id = String(formData.get("id"));
  const batchId = String(formData.get("batch_id") ?? "");
  const unlink = formData.get("unlink") === "1";
  if (!batchId) fail(`/niches/${id}`, "Choisissez un lot.");
  const { error } = await supabase.from("batches").update({ niche_id: unlink ? null : id }).eq("id", batchId);
  if (error) fail(`/niches/${id}`, error.message);
  if (!unlink) {
    // linking a test batch starts the test
    const { data: n } = await supabase.from("niches").select("status, started_at").eq("id", id).single();
    if (n?.status === "idea") {
      await supabase.from("niches").update({ status: "testing", started_at: n.started_at ?? parisToday() }).eq("id", id);
    }
  }
  revalidatePath("/niches");
  redirect(`/niches/${id}`);
}
