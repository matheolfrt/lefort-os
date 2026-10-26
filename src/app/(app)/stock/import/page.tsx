import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { InventoryImport } from "./inventory-import";

export default async function Page() {
  await requireManager();
  const supabase = await createClient();
  const { data: batches } = await supabase.from("batches").select("id, code").eq("status", "open").order("created_at", { ascending: false });
  return (
    <>
      <PageHeader back="/stock" title="Importer l'inventaire" subtitle="Fichier CSV (Excel : Enregistrer sous → CSV UTF-8)." />
      <InventoryImport batches={batches ?? []} />
    </>
  );
}
