import { redirect } from "next/navigation";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, Field, PageHeader, btn, input } from "@/components/ui";
import { parseEuros } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { SkuFields } from "../sku-fields";

async function createBatch(formData: FormData) {
  "use server";
  const ctx = await requireManager();
  const supabase = await createClient();
  const f = (k: string) => String(formData.get(k) ?? "").trim();
  const { data: batch, error } = await supabase
    .from("batches")
    .insert({
      org_id: ctx.org.id,
      code: f("code").toUpperCase(),
      supplier_id: f("supplier_id"),
      purchased_at: f("purchased_at"),
      expected_qty: Number(f("expected_qty")) || null,
      allocation_method: f("allocation_method") || "equal",
      invoice_number: f("invoice_number") || null,
      payment_method: f("payment_method") || null,
      notes: f("notes") || null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) redirect(`/lots/nouveau?error=${encodeURIComponent(error.code === "23505" ? "Ce code de lot existe déjà." : error.message)}`);

  const lines = (["goods", "transport", "customs", "fees"] as const)
    .map((kind) => ({ kind, amount_cents: parseEuros(f(`cost_${kind}`)) }))
    .filter((l) => l.amount_cents)
    .map((l) => ({ ...l, org_id: ctx.org.id, batch_id: batch.id, created_by: ctx.userId }));
  if (lines.length) await supabase.from("batch_cost_lines").insert(lines);
  if (formData.get("sku_custom")) {
    const { error: skuError } = await supabase.rpc("create_batch_skus", {
      p_batch_id: batch.id, p_prefix: f("sku_prefix"), p_start: Number(f("sku_start")) || 0,
      p_count: Number(f("sku_count")) || 0, p_create_items: !!formData.get("sku_items"),
    });
    // the batch exists either way: show the problem on its page, where SKUs can be created again
    if (skuError) redirect(`/lots/${batch.id}?error=${encodeURIComponent(errorMessage(skuError))}`);
  }
  redirect(`/lots/${batch.id}`);
}

export default async function NewBatch({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireManager();
  const { error } = await searchParams;
  const supabase = await createClient();
  const [{ data: suppliers }, { count }] = await Promise.all([
    supabase.from("suppliers").select("id, name").eq("active", true).order("name"),
    supabase.from("batches").select("id", { count: "exact", head: true }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const suggestedCode = `LOT-${today.slice(0, 4)}-${String((count ?? 0) + 1).padStart(2, "0")}`;

  if (!suppliers?.length) redirect("/fournisseurs?error=" + encodeURIComponent("Ajoutez d'abord un fournisseur."));

  return (
    <>
      <PageHeader back="/lots" title="Nouveau lot" subtitle="Montants TTC (en franchise de TVA, la TVA payée fait partie du coût)." />
      <form action={createBatch} className="grid max-w-3xl gap-4 md:grid-cols-2">
        <Card title="Achat">
          <div className="space-y-3">
            <Field label="Code du lot"><input className={`${input} font-mono`} name="code" defaultValue={suggestedCode} pattern="LOT-[A-Za-z0-9-]+" required /></Field>
            <Field label="Fournisseur">
              <select className={input} name="supplier_id" required>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Date d'achat"><input className={input} type="date" name="purchased_at" defaultValue={today} required /></Field>
            <Field label="Nombre d'articles attendu"><input className={input} type="number" name="expected_qty" min={0} inputMode="numeric" /></Field>
            <Field label="N° de facture"><input className={input} name="invoice_number" /></Field>
            <Field label="Mode de règlement">
              <select className={input} name="payment_method" defaultValue="Virement">
                {["Virement", "Carte bancaire", "Espèces", "Chèque", "PayPal"].map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
          </div>
        </Card>
        <Card title="Coûts (€)">
          <div className="space-y-3">
            <Field label="Marchandise"><input className={input} name="cost_goods" inputMode="decimal" placeholder="0,00" /></Field>
            <Field label="Transport"><input className={input} name="cost_transport" inputMode="decimal" placeholder="0,00" /></Field>
            <Field label="Douane"><input className={input} name="cost_customs" inputMode="decimal" placeholder="0,00" /></Field>
            <Field label="Autres frais"><input className={input} name="cost_fees" inputMode="decimal" placeholder="0,00" /></Field>
            <Field label="Répartition du coût" hint="Pondérée : un costume compte 1,8 blazer, un pantalon 0,5… (réglable par catégorie)">
              <select className={input} name="allocation_method" defaultValue="weighted">
                <option value="weighted">Pondérée par catégorie</option>
                <option value="equal">Égale entre articles</option>
              </select>
            </Field>
            <Field label="Notes"><textarea className={`${input} min-h-20 py-2`} name="notes" /></Field>
          </div>
        </Card>
        <Card title="SKU des articles" className="md:col-span-2">
          <SkuFields optional />
        </Card>
        {error && <p className="text-red-300 md:col-span-2">{error}</p>}
        <button className={`${btn.primary} md:col-span-2`}>Créer le lot</button>
      </form>
    </>
  );
}
