import { createClient } from "@/lib/supabase/server";
import { getContext } from "@/lib/session";
import type { BoardData } from "@/lib/production";
import { Production, type Overview, type RefData } from "./production";

export const metadata = { title: "Production" };

export default async function Page() {
  const ctx = await getContext();
  const supabase = await createClient();
  const [board, overview, members, profiles, brands, categories, suppliers, batches] = await Promise.all([
    supabase.rpc("production_board", { p_filters: {}, p_sorts: {}, p_limit: 30 }),
    supabase.rpc("production_overview"),
    supabase.from("memberships").select("user_id, role").eq("active", true),
    supabase.from("profiles").select("id, full_name"),
    supabase.from("brands").select("id, name").order("name"),
    supabase.from("categories").select("id, name").eq("active", true).order("name"),
    supabase.from("suppliers").select("id, name").eq("active", true).order("name"),
    supabase.from("batches").select("id, code").order("purchased_at", { ascending: false }).limit(300),
  ]);

  const names = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name as string]));
  const ref: RefData = {
    members: (members.data ?? []).map((m) => ({ id: m.user_id, name: names.get(m.user_id) || "Sans nom", role: m.role })),
    brands: brands.data ?? [],
    categories: categories.data ?? [],
    suppliers: suppliers.data ?? [],
    batches: batches.data ?? [],
  };

  return (
    <Production
      initialBoard={(board.data as BoardData | null) ?? null}
      initialError={board.error?.message ?? null}
      overview={(overview.data as Overview | null) ?? null}
      refData={ref}
      me={{ id: ctx.userId, name: ctx.fullName, isManager: ctx.isManager }}
    />
  );
}
