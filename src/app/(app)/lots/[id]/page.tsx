import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, SkuLink, Stat, StatusChip, btn, input } from "@/components/ui";
import { date, money, pct } from "@/lib/format";
import type { ItemStatus } from "@/lib/types";
import { addAdjustment, addCostLine, deleteCostLine, setAllocation } from "./actions";
import { LabelPrinter } from "./label-printer";
import { CloseBatchButton } from "./close-batch";

const COST_KIND: Record<string, string> = { goods: "Marchandise", transport: "Transport", customs: "Douane", fees: "Frais", other: "Autre" };

export default async function BatchDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  const supabase = await createClient();

  const { data: batch } = await supabase.from("batches").select("*, suppliers(name)").eq("id", id).maybeSingle();
  if (!batch) notFound();

  const [{ data: progress }, { data: items }, { data: labels }, econ, lines, adjustments, costs] = await Promise.all([
    supabase.from("v_batch_progress").select("*").eq("batch_id", id).single(),
    supabase.from("items").select("id, sku, status, size_label, categories(name), brands(name)").eq("batch_id", id).is("deleted_at", null).order("sku"),
    supabase.from("sku_labels").select("sku").eq("batch_id", id),
    ctx.isManager ? supabase.from("v_batch_profitability").select("*").eq("batch_id", id).maybeSingle() : null,
    ctx.isManager ? supabase.from("batch_cost_lines").select("*").eq("batch_id", id).order("created_at") : null,
    ctx.isManager ? supabase.from("batch_cost_adjustments").select("*").eq("batch_id", id).order("created_at") : null,
    ctx.isManager ? supabase.from("item_costs").select("item_id, allocated_cost_cents, manual") : null,
  ]);
  const costById = new Map((costs?.data ?? []).map((c) => [c.item_id, c]));
  const e = econ?.data;
  const open = batch.status === "open";
  const unused = (labels?.length ?? 0) - (items?.length ?? 0);
  const suggested = Math.max((batch.expected_qty ?? 0) - (labels?.length ?? 0), 0);

  return (
    <>
      <PageHeader
        back="/lots"
        title={batch.code}
        subtitle={<>{(batch.suppliers as unknown as { name: string })?.name} · acheté le {date(batch.purchased_at)} · {open ? "ouvert" : `clôturé le ${date(batch.closed_at)}`}</>}
        actions={
          <>
            {open && <Link href={`/postes/reception?batch=${batch.id}`} className={btn.primary}>Réceptionner</Link>}
            {ctx.isManager && open && <CloseBatchButton batchId={batch.id} />}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Reçus" value={`${progress?.items ?? 0}${batch.expected_qty ? ` / ${batch.expected_qty}` : ""}`} />
        <Stat label="Photographiés" value={progress?.photographed ?? 0} />
        <Stat label="Publiés" value={progress?.listed ?? 0} />
        <Stat label="Vendus" value={progress?.sold ?? 0} />
        <Stat label="Écartés" value={progress?.rejected ?? 0} />
      </div>

      {ctx.isManager && e && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Coût total" value={money(e.total_cost_cents)} hint={e.items ? `${money(Math.round(e.total_cost_cents / e.items))} / article` : undefined} />
          <Stat label="CA" value={money(e.revenue_cents)} />
          <Stat label="Profit réalisé" value={money(e.profit_cents)} hint="coût total du lot déduit" />
          <Stat label="ROI" value={pct(e.roi_pct)} />
          <Stat label="Écoulement" value={pct(e.sell_through_pct)} hint={e.avg_days_to_sell ? `${e.avg_days_to_sell} j en moyenne` : undefined} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title={`Articles (${items?.length ?? 0})`}>
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>SKU</th><th>Statut</th><th>Catégorie</th><th>Marque</th><th>Taille</th>{ctx.isManager && <th className="num">Coût</th>}</tr></thead>
              <tbody>
                {(items ?? []).map((i) => {
                  const c = costById.get(i.id);
                  return (
                    <tr key={i.id}>
                      <td><SkuLink sku={i.sku} /></td>
                      <td><StatusChip status={i.status as ItemStatus} /></td>
                      <td>{(i.categories as unknown as { name: string } | null)?.name ?? "—"}</td>
                      <td>{(i.brands as unknown as { name: string } | null)?.name ?? "—"}</td>
                      <td>{i.size_label ?? "—"}</td>
                      {ctx.isManager && <td className="num">{money(c?.allocated_cost_cents)}{c?.manual && " ✎"}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Étiquettes">
            <p className="mb-3 text-sm text-muted">{labels?.length ?? 0} générées · {Math.max(unused, 0)} non utilisées</p>
            <LabelPrinter batchId={batch.id} unused={Math.max(unused, 0)} suggested={suggested} open={open} />
          </Card>

          {ctx.isManager && (
            <Card title="Coûts">
              <table className="data mb-3">
                <tbody>
                  {(lines?.data ?? []).map((l) => (
                    <tr key={l.id}>
                      <td>{COST_KIND[l.kind]}{l.description && <div className="text-xs text-muted">{l.description}</div>}</td>
                      <td className="num">{money(l.amount_cents)}</td>
                      {open && (
                        <td className="w-8">
                          <form action={deleteCostLine.bind(null, batch.id, l.id)}><button className="text-red-600" aria-label="Supprimer">×</button></form>
                        </td>
                      )}
                    </tr>
                  ))}
                  {(adjustments?.data ?? []).map((a) => (
                    <tr key={a.id}><td>Ajustement<div className="text-xs text-muted">{a.reason}</div></td><td className="num">{money(a.amount_cents)}</td></tr>
                  ))}
                </tbody>
              </table>
              {open ? (
                <>
                  <form action={addCostLine.bind(null, batch.id)} className="mb-3 grid grid-cols-[1fr_90px_auto] gap-2">
                    <select name="kind" className={input}>
                      {Object.entries(COST_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <input name="amount" className={input} inputMode="decimal" placeholder="€" required />
                    <button className={btn.secondary}>+</button>
                  </form>
                  <form className="flex gap-2" action={async (fd: FormData) => { "use server"; await setAllocation(batch.id, String(fd.get("m"))); }}>
                    <select name="m" defaultValue={batch.allocation_method} className={input}>
                      <option value="weighted">Répartition pondérée</option>
                      <option value="equal">Répartition égale</option>
                    </select>
                    <button className={btn.secondary}>OK</button>
                  </form>
                </>
              ) : (
                <form action={addAdjustment.bind(null, batch.id)} className="space-y-2">
                  <p className="text-xs text-muted">Lot clôturé : ajoutez un ajustement tracé (ex. facture de transport reçue après coup, -10 pour un avoir).</p>
                  <input name="amount" className={input} inputMode="decimal" placeholder="Montant €" required />
                  <input name="reason" className={input} placeholder="Motif" required />
                  <button className={`${btn.secondary} w-full`}>Ajouter l&apos;ajustement</button>
                </form>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
