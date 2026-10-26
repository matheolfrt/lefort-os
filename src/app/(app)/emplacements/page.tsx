import Link from "next/link";
import { revalidatePath } from "next/cache";
import { getContext, requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, Field, PageHeader, btn, input } from "@/components/ui";

async function createRange(formData: FormData) {
  "use server";
  await requireManager();
  const supabase = await createClient();
  await supabase.rpc("create_location_range", {
    p_zone: String(formData.get("zone")).toUpperCase(),
    p_shelves: Number(formData.get("shelves")),
    p_bins: Number(formData.get("bins")),
    p_capacity: Number(formData.get("capacity")) || null,
  });
  revalidatePath("/emplacements");
}

export default async function Locations() {
  const ctx = await getContext();
  const supabase = await createClient();
  const [{ data: locations }, { data: items }] = await Promise.all([
    supabase.from("locations").select("*").eq("active", true).order("kind").order("pick_order").order("code"),
    supabase.from("items").select("current_location_id").is("deleted_at", null).not("status", "in", "(shipped,completed)"),
  ]);
  const count = new Map<string, number>();
  (items ?? []).forEach((i) => i.current_location_id && count.set(i.current_location_id, (count.get(i.current_location_id) ?? 0) + 1));
  const storage = (locations ?? []).filter((l) => l.kind === "storage");
  const staging = (locations ?? []).filter((l) => l.kind === "staging");

  return (
    <>
      <PageHeader
        title="Emplacements"
        subtitle="Zone-étagère-bac. Un article est toujours dans un seul emplacement."
        actions={<a className={btn.secondary} href="/etiquettes/emplacements" target="_blank">Imprimer toutes les étiquettes (4×6)</a>}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <Card title="Zones de travail">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {staging.map((l) => (
                <Link key={l.id} href={`/emplacements/${l.code}`} className="rounded-md border border-line p-3 hover:border-accent">
                  <div className="text-sm font-semibold">{l.label}</div>
                  <div className="text-2xl font-mono font-semibold tabular-nums">{count.get(l.id) ?? 0}</div>
                </Link>
              ))}
            </div>
          </Card>
          <Card title={`Stockage (${storage.length})`}>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
              {storage.map((l) => {
                const n = count.get(l.id) ?? 0;
                const full = l.capacity && n >= l.capacity;
                return (
                  <Link key={l.id} href={`/emplacements/${l.code}`}
                    className={`rounded-md border p-2 text-center hover:border-accent ${full ? "border-red-500 bg-red-500/15 text-red-200" : n ? "border-line bg-panel" : "border-dashed border-line"}`}>
                    <div className="font-mono text-xs font-semibold">{l.code.replace("EMP-", "")}</div>
                    <div className="text-lg font-mono font-semibold tabular-nums">{n}{l.capacity ? <span className="text-xs font-normal">/{l.capacity}</span> : null}</div>
                  </Link>
                );
              })}
            </div>
          </Card>
        </div>
        {ctx.isManager && (
          <Card title="Créer des emplacements">
            <form action={createRange} className="space-y-3">
              <Field label="Zone (lettre)"><input className={`${input} uppercase`} name="zone" defaultValue="A" maxLength={3} required /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Étagères"><input className={input} name="shelves" type="number" min={1} max={99} defaultValue={4} required /></Field>
                <Field label="Bacs / étagère"><input className={input} name="bins" type="number" min={1} max={99} defaultValue={5} required /></Field>
              </div>
              <Field label="Capacité par bac (optionnel)"><input className={input} name="capacity" type="number" min={1} /></Field>
              <button className={`${btn.primary} w-full`}>Créer</button>
              <p className="text-xs text-muted">Ex. zone A, 4 étagères × 5 bacs → EMP-A-01-01 … EMP-A-04-05. Les existants sont ignorés.</p>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
