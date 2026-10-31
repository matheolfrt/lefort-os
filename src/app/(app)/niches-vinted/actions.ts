"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { collect, parseVintedUrl, type CollectSummary, type Job, type MarketQuery } from "@/lib/market/collect";

const back = (msg: string, to = "/niches-vinted") => redirect(`${to}${to.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);

/** A search to follow: some words, or the address of a Vinted search page (its filters are kept) */
export async function createSearch(formData: FormData) {
  await requireManager();
  const raw = String(formData.get("search") ?? "").trim();
  let name = String(formData.get("name") ?? "").trim();
  if (!raw) back("Tapez ce que vous cherchez, ou collez l'adresse d'une recherche Vinted.");
  let domain = "www.vinted.fr", query: MarketQuery;
  if (/^https?:\/\//i.test(raw)) {
    const p = parseVintedUrl(raw);
    if (!p) back("Cette adresse n'est pas une recherche Vinted avec des filtres (exemple : https://www.vinted.fr/catalog?search_text=blazer).");
    ({ domain, query } = p!);
  } else query = { search_text: raw.slice(0, 120) };
  const euros = (k: string) => { const v = Number(String(formData.get(k) ?? "").replace(",", ".")); return Number.isFinite(v) && v > 0 ? v : undefined; };
  if (euros("price_from")) query.price_from = euros("price_from");
  if (euros("price_to")) query.price_to = euros("price_to");
  if (!name) name = (query.search_text ?? "Recherche Vinted").slice(0, 80);
  const supabase = await createClient();
  const { data, error } = await supabase.from("market_searches").insert({ name: name.slice(0, 80), query, domain }).select("id").single();
  if (error) back(error.message);
  revalidatePath("/niches-vinted");
  redirect(`/niches-vinted/${data!.id}?cree=1`);
}

export async function setSearchActive(id: string, active: boolean) {
  await requireManager();
  const supabase = await createClient();
  const { error } = await supabase.from("market_searches").update({ active }).eq("id", id);
  if (error) back(error.message, `/niches-vinted/${id}`);
  revalidatePath(`/niches-vinted/${id}`);
}

export async function deleteSearch(id: string) {
  await requireManager();
  const supabase = await createClient();
  const { error } = await supabase.from("market_searches").delete().eq("id", id);
  if (error) back(error.message, `/niches-vinted/${id}`);
  revalidatePath("/niches-vinted");
  redirect("/niches-vinted?supprimee=1");
}

/** A key for a collector, shown once */
export async function createKey(label: string): Promise<{ key?: string; error?: string }> {
  await requireManager();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("market_create_key", { p_label: label.trim().slice(0, 60) || "Collecteur" });
  revalidatePath("/niches-vinted");
  return error ? { error: error.message } : { key: data as string };
}

export async function revokeKey(id: string) {
  await requireManager();
  const supabase = await createClient();
  await supabase.rpc("market_revoke_key", { p_id: id });
  revalidatePath("/niches-vinted");
}

/**
 * A pass made now from the Lefort OS server (Vercel): the real test of whether Vinted answers this server. Small on
 * purpose (one page, a few listings looked at again), and recorded like any other pass.
 */
export async function runNow(searchId: string | null): Promise<{ summary?: CollectSummary; error?: string }> {
  await requireManager();
  const supabase = await createClient();
  try {
    const summary = await collect({
      link: {
        jobs: async (recheck, id) => {
          const { data, error } = await supabase.rpc("market_jobs", { p_token: null, p_recheck: recheck, p_search_id: id ?? null });
          if (error) throw new Error(error.message);
          return (data as { searches: Job[] }).searches;
        },
        ingest: async (id, payload) => {
          const { error } = await supabase.rpc("market_ingest", { p_token: null, p_search_id: id, p_collector: "manuel", p_payload: payload });
          if (error) throw new Error(error.message);
        },
      },
      searchId: searchId ?? undefined, maxSearches: searchId ? 1 : 3, maxPages: 1, maxChecks: 10, maxRequests: 30, delayMs: 700,
    });
    revalidatePath("/niches-vinted");
    if (searchId) revalidatePath(`/niches-vinted/${searchId}`);
    return { summary };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inconnue" };
  }
}
