import { createClient } from "@/lib/supabase/server";
import { StorageStation } from "./station";

export default async function Page() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("items")
    .select("id, sku, status, size_label, categories(name), brands(name)")
    .in("status", ["measured", "returned"])
    .is("deleted_at", null)
    .order("status_changed_at")
    .limit(200);
  const queue = (data ?? []).map((i) => ({
    id: i.id,
    sku: i.sku,
    label: [(i.categories as unknown as { name: string } | null)?.name, (i.brands as unknown as { name: string } | null)?.name, i.size_label && `T${i.size_label}`]
      .filter(Boolean)
      .join(" · "),
  }));
  return <StorageStation initialQueue={queue} />;
}
