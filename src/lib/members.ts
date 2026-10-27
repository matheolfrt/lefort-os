import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Active members of the team with their names, for "who" pickers */
export async function loadMembers(supabase: SupabaseClient): Promise<{ id: string; name: string }[]> {
  const [{ data: ms }, { data: ps }] = await Promise.all([
    supabase.from("memberships").select("user_id").eq("active", true),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const names = new Map((ps ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? ""]));
  return (ms ?? []).map((m) => ({ id: m.user_id as string, name: names.get(m.user_id as string) || "Sans nom" }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}
