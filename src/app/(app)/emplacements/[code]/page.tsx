import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageHeader, SkuLink, StatusChip, btn } from "@/components/ui";
import type { ItemStatus } from "@/lib/types";

export default async function LocationPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();
  const { data: loc } = await supabase.from("locations").select("*").eq("code", decodeURIComponent(code).toUpperCase()).maybeSingle();
  if (!loc) notFound();
  const { data: items } = await supabase
    .from("items")
    .select("id, sku, status, title, size_label")
    .eq("current_location_id", loc.id)
    .is("deleted_at", null)
    .order("sku");
  return (
    <>
      <PageHeader
        back="/emplacements"
        title={loc.code.replace("EMP-", "")}
        subtitle={`${loc.label ?? loc.kind} · ${items?.length ?? 0} article(s)${loc.capacity ? ` / ${loc.capacity}` : ""}`}
        actions={<a className={btn.secondary} href={`/etiquettes/emplacements?codes=${loc.code}`} target="_blank">Étiquette</a>}
      />
      {!items?.length ? <Empty>Emplacement vide.</Empty> : (
        <Card>
          <table className="data">
            <tbody>
              {items.map((i) => (
                <tr key={i.id}><td><SkuLink sku={i.sku} /></td><td><StatusChip status={i.status as ItemStatus} /></td><td>{i.title}</td><td>{i.size_label}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
