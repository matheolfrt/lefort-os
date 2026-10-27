import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/session";
import { NicheForm } from "../niche-form";

export const metadata = { title: "Nouvelle niche" };

export default async function NewNiche({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireManager();
  const { error } = await searchParams;
  const supabase = await createClient();
  const [{ data: brands }, { data: categories }] = await Promise.all([
    supabase.from("brands").select("id, name").order("name"),
    supabase.from("categories").select("id, name").eq("active", true).order("name"),
  ]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader back="/niches" title="Nouvelle niche" subtitle="Décrivez ce que vous voulez tester : Lefort OS mesurera les résultats sur vos ventes." />
      {error && <p className="mb-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
      <NicheForm niche={null} brands={brands ?? []} categories={categories ?? []} />
    </div>
  );
}
