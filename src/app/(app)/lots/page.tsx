import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageHeader, btn } from "@/components/ui";
import { date, money, pct } from "@/lib/format";

export default async function Batches({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const ctx = await getContext();
  const { code } = await searchParams;
  const supabase = await createClient();
  if (code) {
    const { data } = await supabase.from("batches").select("id").eq("code", code).maybeSingle();
    if (data) redirect(`/lots/${data.id}`);
  }
  const [{ data: progress }, { data: econ }] = await Promise.all([
    supabase.from("v_batch_progress").select("*").order("purchased_at", { ascending: false }),
    ctx.isManager ? supabase.from("v_batch_profitability").select("*") : Promise.resolve({ data: [] }),
  ]);
  const econById = new Map((econ ?? []).map((e) => [e.batch_id, e]));

  return (
    <>
      <PageHeader
        title="Lots"
        subtitle="Chaque achat fournisseur = un lot. Les coûts sont répartis automatiquement sur les articles."
        actions={ctx.isManager && <Link href="/lots/nouveau" className={btn.primary}>Nouveau lot</Link>}
      />
      {(progress ?? []).length === 0 ? (
        <Empty>Aucun lot. Créez votre premier lot pour imprimer les étiquettes.</Empty>
      ) : (
        <>
          {/* Phone: one card per batch */}
          <ul className="space-y-2 md:hidden">
            {(progress ?? []).map((b) => {
              const e = econById.get(b.batch_id);
              return (
                <li key={b.batch_id}>
                  <Link href={`/lots/${b.batch_id}`} className="block rounded-xl border border-line bg-panel p-4 active:scale-[0.99]">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono font-bold">{b.code}</span>
                      <span className="text-xs text-muted">{b.status === "closed" ? "clôturé · " : ""}{date(b.purchased_at)}</span>
                    </div>
                    <div className="mb-2 text-sm text-muted">{b.supplier_name}</div>
                    <Funnel b={b} />
                    {ctx.isManager && e && (
                      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-2 text-sm">
                        <div><div className="text-[10px] font-semibold uppercase text-muted">Coût</div><div className="tabular-nums">{money(e.total_cost_cents)}</div></div>
                        <div><div className="text-[10px] font-semibold uppercase text-muted">CA</div><div className="tabular-nums">{money(e.revenue_cents)}</div></div>
                        <div><div className="text-[10px] font-semibold uppercase text-muted">ROI</div><div className={`font-semibold tabular-nums ${Number(e.roi_pct) < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{pct(e.roi_pct)}</div></div>
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          <Card className="hidden !p-0 md:block">
            <div className="overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Lot</th><th>Fournisseur</th><th>Achat</th><th>Avancement</th>
                    {ctx.isManager && (<><th className="num">Coût</th><th className="num">CA</th><th className="num">Profit</th><th className="num">ROI</th></>)}
                  </tr>
                </thead>
                <tbody>
                  {(progress ?? []).map((b) => {
                    const e = econById.get(b.batch_id);
                    return (
                      <tr key={b.batch_id}>
                        <td>
                          <Link href={`/lots/${b.batch_id}`} className="font-mono font-semibold hover:text-accent hover:underline">{b.code}</Link>
                          {b.status === "closed" && <span className="ml-2 text-xs text-muted">clôturé</span>}
                        </td>
                        <td>{b.supplier_name}</td>
                        <td>{date(b.purchased_at)}</td>
                        <td className="min-w-48"><Funnel b={b} /></td>
                        {ctx.isManager && (
                          <>
                            <td className="num">{money(e?.total_cost_cents)}</td>
                            <td className="num">{money(e?.revenue_cents)}</td>
                            <td className={`num font-semibold ${Number(e?.profit_cents) < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{money(e?.profit_cents)}</td>
                            <td className="num">{pct(e?.roi_pct)}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

function Funnel({ b }: { b: { items: number; listed: number; sold: number; expected_qty: number | null } }) {
  const total = Math.max(b.items, b.expected_qty ?? 0, 1);
  return (
    <div>
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-line">
        <div className="bg-orange-500" style={{ width: `${(b.sold / total) * 100}%` }} />
        <div className="bg-emerald-500" style={{ width: `${((b.listed - b.sold) / total) * 100}%` }} />
        <div className="bg-slate-400" style={{ width: `${((b.items - b.listed) / total) * 100}%` }} />
      </div>
      <div className="mt-1 text-xs text-muted">
        {b.items}{b.expected_qty ? `/${b.expected_qty}` : ""} reçus · {b.listed} publiés · {b.sold} vendus
      </div>
    </div>
  );
}
