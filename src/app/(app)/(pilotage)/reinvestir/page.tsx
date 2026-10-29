import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { loadBaseline } from "@/lib/scenario-baseline";
import { ReinvestStudio } from "./reinvest-studio";

export const metadata = { title: "Réinvestir" };

/** « Si je réinvestis tant » : the turnover it would bring in 3 months, 6 months, a year, on the business's own figures */
export default async function Reinvest() {
  const ctx = await requireManager();
  const supabase = await createClient();
  const baseline = await loadBaseline(supabase, ctx.org);
  return <ReinvestStudio baseline={baseline} />;
}
