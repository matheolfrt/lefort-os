import { getContext } from "@/lib/session";
import { loadCatalog } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/server";
import { ReceptionStation } from "./station";

export default async function Page({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  const ctx = await getContext();
  const { batch } = await searchParams;
  const supabase = await createClient();
  const [catalog, { data: batches }] = await Promise.all([
    loadCatalog(),
    supabase.from("batches").select("id, code, expected_qty").eq("status", "open").order("purchased_at", { ascending: false }),
  ]);
  return <ReceptionStation catalog={catalog} batches={batches ?? []} initialBatch={batch ?? null} orgId={ctx.org.id} />;
}
