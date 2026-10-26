import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { loadBaseline } from "@/lib/scenario-baseline";
import { DEFAULTS, type ScenarioInputs } from "@/lib/scenario";
import { ScenarioStudio, type SavedScenario } from "./scenario-studio";

export default async function Scenarios() {
  const ctx = await requireManager();
  const supabase = await createClient();
  const [baseline, { data }] = await Promise.all([
    loadBaseline(supabase, ctx.org),
    supabase.from("scenarios").select("id, name, inputs, created_at").order("created_at"),
  ]);
  const saved: SavedScenario[] = (data ?? []).map((s) => ({
    id: s.id as string, name: s.name as string, inputs: { ...DEFAULTS, ...(s.inputs as Partial<ScenarioInputs>) },
  }));
  return <ScenarioStudio orgId={ctx.org.id} baseline={baseline} saved={saved} />;
}
