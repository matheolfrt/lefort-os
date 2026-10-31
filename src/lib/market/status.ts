// The state of each collector, from its passes (market_runs): the last one, and how many worked over 7 days
import type { SupabaseClient } from "@supabase/supabase-js";

export const COLLECTORS = [
  { id: "github", label: "GitHub Actions" },
  { id: "vercel", label: "Serveur Vercel" },
  { id: "cloudflare", label: "Cloudflare" },
  { id: "manuel", label: "Passage manuel" },
] as const;

interface Run { collector: string; at: string; ok: boolean; http_status: number | null; error: string | null; seen: number }

export async function collectorStates(supabase: SupabaseClient, searchId?: string) {
  let q = supabase.from("market_runs").select("collector, at, ok, http_status, error, seen")
    .gte("at", new Date(Date.now() - 7 * 86_400_000).toISOString()).order("at", { ascending: false }).limit(2000);
  if (searchId) q = q.eq("search_id", searchId);
  const { data } = await q;
  const runs = (data ?? []) as Run[];
  return COLLECTORS.map((c) => {
    const mine = runs.filter((r) => r.collector === c.id);
    const l = mine[0];
    return { id: c.id, label: c.label, ok7: mine.filter((r) => r.ok).length, runs7: mine.length,
      last: l ? { at: l.at, ok: l.ok, http: l.http_status, error: l.error, seen: l.seen } : null };
  });
}
