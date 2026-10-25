import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, Field, PageHeader, btn, input } from "@/components/ui";
import { money, pct } from "@/lib/format";

async function createSupplier(formData: FormData) {
  "use server";
  const ctx = await requireManager();
  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").insert({
    org_id: ctx.org.id,
    name: String(formData.get("name")).trim(),
    country: String(formData.get("country") || "") || null,
    contact: String(formData.get("contact") || "") || null,
    created_by: ctx.userId,
  });
  if (error) redirect(`/fournisseurs?error=${encodeURIComponent(error.code === "23505" ? "Ce fournisseur existe déjà." : error.message)}`);
  revalidatePath("/fournisseurs");
}

export default async function Suppliers({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireManager();
  const { error } = await searchParams;
  const supabase = await createClient();
  const [{ data: suppliers }, { data: perf }] = await Promise.all([
    supabase.from("suppliers").select("*").order("name"),
    supabase.from("v_supplier_profitability").select("*"),
  ]);
  const perfById = new Map((perf ?? []).map((p) => [p.supplier_id, p]));

  return (
    <>
      <PageHeader title="Fournisseurs" subtitle="Performance calculée sur l'ensemble des lots (n = nombre d'articles)." />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Fournisseur</th><th className="num">Lots</th><th className="num">Articles</th>
                  <th className="num">Coût</th><th className="num">CA</th><th className="num">Profit</th>
                  <th className="num">ROI</th><th className="num">Écoulement</th>
                </tr>
              </thead>
              <tbody>
                {(suppliers ?? []).map((s) => {
                  const p = perfById.get(s.id);
                  return (
                    <tr key={s.id}>
                      <td className="font-semibold">{s.name}<div className="text-xs font-normal text-muted">{[s.country, s.contact].filter(Boolean).join(" · ")}</div></td>
                      <td className="num">{p?.batches ?? 0}</td>
                      <td className="num">{p?.items ?? 0}</td>
                      <td className="num">{money(p?.total_cost_cents)}</td>
                      <td className="num">{money(p?.revenue_cents)}</td>
                      <td className="num">{money(p?.profit_cents)}</td>
                      <td className="num">{pct(p?.roi_pct)}</td>
                      <td className="num">{pct(p?.sell_through_pct)} <span className="text-xs text-muted">n={p?.items_sold ?? 0}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Nouveau fournisseur">
          <form action={createSupplier} className="space-y-3">
            <Field label="Nom"><input className={input} name="name" required /></Field>
            <Field label="Pays"><input className={input} name="country" /></Field>
            <Field label="Contact"><input className={input} name="contact" /></Field>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button className={`${btn.primary} w-full`}>Ajouter</button>
          </form>
        </Card>
      </div>
    </>
  );
}
