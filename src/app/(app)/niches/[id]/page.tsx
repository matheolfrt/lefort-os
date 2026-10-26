import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader, StatusChip, btn, input } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/session";
import { eur } from "@/lib/advisor";
import { date } from "@/lib/format";
import { STATUS, criteria, eur2, judge, type Metrics, type Niche, type NicheStats } from "@/lib/niches";
import type { ItemStatus } from "@/lib/types";
import { decide, deleteNiche, linkBatch } from "../actions";
import { NicheForm } from "../niche-form";

export const metadata = { title: "Niche" };

interface Row {
  item_id: string; sku: string; brand: string | null; title: string | null; size_label: string | null; status: ItemStatus;
  is_sold: boolean; list_price_cents: number | null; revenue_cents: number; cost_cents: number; profit_cents: number;
  days_in_stock: number | null; in_test: boolean;
}

export default async function NichePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requireManager();
  const { id } = await params;
  const { error, ok } = await searchParams;
  const supabase = await createClient();
  const [{ data: niche }, { data: stats }, { data: items }, { data: brands }, { data: categories }, { data: linked }, { data: batches }] = await Promise.all([
    supabase.from("niches").select("*").eq("id", id).maybeSingle(),
    supabase.rpc("niche_stats"),
    supabase.rpc("niche_item_list", { p_niche_id: id, p_limit: 300 }),
    supabase.from("brands").select("id, name").order("name"),
    supabase.from("categories").select("id, name").eq("active", true).order("name"),
    supabase.from("batches").select("id, code, purchased_at").eq("niche_id", id).order("purchased_at", { ascending: false }),
    supabase.from("batches").select("id, code, niche_id").is("niche_id", null).order("purchased_at", { ascending: false }).limit(100),
  ]);
  if (!niche) notFound();
  const n = niche as Niche;
  const s = stats as NicheStats | null;
  const ref = s?.reference ?? { sold: 0, profit_per_item_cents: null, avg_days: null };
  const st = s?.niches.find((x) => x.id === n.id);
  const needed = n.test_items ?? 5;
  const rows = (items ?? []) as Row[];
  const brandName = new Map((brands ?? []).map((b) => [b.id as string, b.name as string]));
  const catName = new Map((categories ?? []).map((c) => [c.id as string, c.name as string]));
  const main = n.status === "testing" && st?.test ? st.test : st?.all ?? null;
  const v = judge(main, ref, needed);

  return (
    <div className="space-y-4">
      <PageHeader back="/niches" title={n.name}
        subtitle={<span className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[n.status].cls}`}>{STATUS[n.status].label}</span>
          {n.started_at && <span>test depuis le {date(n.started_at)}</span>}
          {n.decided_at && <span>· décidé le {date(n.decided_at)}</span>}
        </span>} />
      {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
      {ok && <p className="rounded-xl bg-accent/10 p-3 text-sm text-accent">Niche enregistrée.</p>}

      <Card>
        <div className="flex flex-wrap items-start gap-3">
          <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-sm font-semibold ${v.cls}`} data-testid="verdict">{v.label}</span>
          <p className="min-w-0 flex-1 text-[15px]">{v.text}</p>
        </div>
        {n.hypothesis && <p className="mt-3 border-l-2 border-line pl-3 text-sm text-muted">Hypothèse : {n.hypothesis}</p>}
        {n.decision_note && <p className="mt-2 border-l-2 border-line pl-3 text-sm text-muted">Décision : {n.decision_note}</p>}
        <p className="mt-2 text-xs text-muted">Critères : {criteria(n, brandName, catName)}</p>

        {/* decision */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          {n.status === "idea" && <StatusButton id={n.id} status="testing" label="Lancer le test" primary />}
          {n.status === "testing" && (
            <form action={decide.bind(null, null)} className="flex w-full flex-wrap gap-2">
              <input type="hidden" name="id" value={n.id} />
              <input className={`${input} min-w-48 flex-1`} name="note" placeholder="Pourquoi cette décision ? (facultatif)" aria-label="Note de décision" />
              <button formAction={decide.bind(null, "validated")} className={btn.primary}>Valider la niche</button>
              <button formAction={decide.bind(null, "dropped")} className={btn.secondary}>Abandonner</button>
            </form>
          )}
          {(n.status === "validated" || n.status === "dropped") && <StatusButton id={n.id} status="testing" label="Reprendre le test" />}
          {n.status !== "idea" && <StatusButton id={n.id} status="idea" label="Remettre en idée" />}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Results title="Articles du test" hint={n.started_at ? `lots rattachés et articles reçus depuis le ${date(n.started_at)}` : "lots rattachés à la niche"} m={st?.test ?? null} n={n} reference={ref} needed={needed} />
        <Results title="Tous les articles correspondants" hint="historique compris" m={st?.all ?? null} n={n} reference={ref} needed={needed} />
      </div>

      <Card title="Lots de test">
        <p className="mb-3 text-sm text-muted">Rattachez le lot acheté pour tester cette niche : tous ses articles comptent dans le test, quels que soient les critères. Rattacher un lot lance le test.</p>
        {(linked ?? []).length > 0 && (
          <ul className="mb-3 divide-y divide-line rounded-xl border border-line">
            {(linked ?? []).map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-3 py-2">
                <Link prefetch={false} href={`/lots/${b.id}`} className="font-mono font-semibold hover:text-accent">{b.code}</Link>
                <span className="flex-1 text-sm text-muted">acheté le {date(b.purchased_at)}</span>
                <form action={linkBatch}>
                  <input type="hidden" name="id" value={n.id} /><input type="hidden" name="batch_id" value={b.id} /><input type="hidden" name="unlink" value="1" />
                  <button className="min-h-9 rounded-lg px-2 text-sm text-muted hover:text-fg">Détacher</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={linkBatch} className="flex flex-wrap gap-2">
          <input type="hidden" name="id" value={n.id} />
          <select name="batch_id" className={`${input} min-w-48 flex-1`} aria-label="Lot à rattacher" defaultValue="">
            <option value="" disabled>Choisir un lot…</option>
            {(batches ?? []).map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
          </select>
          <button className={btn.secondary}>Rattacher le lot</button>
          <Link href={`/lots/nouveau?niche=${n.id}`} className={btn.primary}>Nouveau lot de test</Link>
        </form>
      </Card>

      <Card title={`Articles (${rows.length}${rows.length >= 300 ? "+" : ""})`}>
        {rows.length === 0 ? <p className="text-sm text-muted">Aucun article ne correspond pour l&apos;instant.</p> : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>SKU</th><th>Article</th><th>Statut</th><th className="num">Prix</th><th className="num">Coût</th><th className="num">Marge</th><th className="num">Délai</th><th>Test</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.item_id}>
                    <td><Link prefetch={false} href={`/stock/${encodeURIComponent(r.sku)}`} className="font-mono font-semibold hover:text-accent">{r.sku}</Link></td>
                    <td className="max-w-64 truncate">{[r.brand, r.title, r.size_label && `T${r.size_label}`].filter(Boolean).join(" · ") || "—"}</td>
                    <td><StatusChip status={r.status} /></td>
                    <td className="num">{eur(r.is_sold ? r.revenue_cents : r.list_price_cents)}</td>
                    <td className="num">{eur(r.cost_cents)}</td>
                    <td className={`num ${r.is_sold && r.profit_cents < 0 ? "text-red-300" : ""}`}>{r.is_sold ? eur(r.profit_cents) : "—"}</td>
                    <td className="num">{r.days_in_stock == null ? "—" : `${Math.round(r.days_in_stock)} j`}</td>
                    <td>{r.in_test ? <span className="text-xs text-sky-200">test</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <details className="rounded-2xl border border-line bg-panel/60 p-4" open={!!error}>
        <summary className="cursor-pointer font-medium">Modifier les critères et objectifs</summary>
        <div className="mt-4"><NicheForm niche={n} brands={brands ?? []} categories={categories ?? []} /></div>
      </details>

      <form action={deleteNiche} className="text-right">
        <input type="hidden" name="id" value={n.id} />
        <button className="min-h-10 text-sm text-red-300/80 hover:text-red-300">Supprimer la niche</button>
      </form>
    </div>
  );
}

function StatusButton({ id, status, label, primary }: { id: string; status: string; label: string; primary?: boolean }) {
  return (
    <form action={decide.bind(null, status as "idea" | "testing")}>
      <input type="hidden" name="id" value={id} />
      <button className={primary ? btn.primary : btn.secondary}>{label}</button>
    </form>
  );
}

function Results({ title, hint, m, n, reference: ref, needed }: {
  title: string; hint: string; m: Metrics | null; n: Niche; reference: NicheStats["reference"]; needed: number;
}) {
  const v = judge(m, ref, needed);
  const refPpd = ref.profit_per_item_cents != null && ref.avg_days ? ref.profit_per_item_cents / Math.max(ref.avg_days, 1) : null;
  const rows: [string, string, string?][] = m ? [
    ["Articles", String(m.items)],
    ["Vendus", `${m.sold} (${v.sellThrough ?? 0} %)`, `objectif : ${needed} ventes`],
    ["En stock", String(m.in_stock)],
    ["Payé (coût d'achat)", eur(m.cost), n.budget_cents ? `budget : ${eur(n.budget_cents)}` : undefined],
    ["Chiffre d'affaires", eur(m.revenue)],
    ["Marge par article vendu", eur(v.profitPerItem), `vous : ${eur(ref.profit_per_item_cents)}`],
    ["Délai de vente", m.days == null ? "—" : `${Math.round(m.days)} j`, `vous : ${ref.avg_days == null ? "—" : `${Math.round(ref.avg_days)} j`}`],
    ["Marge par jour de stock", eur2(v.profitPerDay), `vous : ${eur2(refPpd)}`],
    ["Retour sur l'argent investi", v.roi == null ? "—" : `${v.roi} %`, "invendus compris"],
    ["Prix d'achat moyen", eur(m.avg_cost), n.target_buy_cents ? `visé : ${eur(n.target_buy_cents)}` : undefined],
    ["Prix de vente moyen", eur(m.avg_price), n.target_sell_cents ? `visé : ${eur(n.target_sell_cents)}` : undefined],
    ["Prix d'achat max conseillé", eur(v.maxBuyCents), "pour garder votre marge moyenne"],
  ] : [];
  return (
    <Card title={title}>
      <p className="-mt-2 mb-2 text-xs text-muted">{hint}</p>
      {!m ? <p className="text-sm text-muted">Aucun article pour l&apos;instant.</p> : (
        <dl className="divide-y divide-line text-sm">
          {rows.map(([k, val, sub]) => (
            <div key={k} className="flex items-baseline gap-3 py-1.5">
              <dt className="flex-1 text-muted">{k}</dt>
              <dd className="text-right"><span className="font-mono font-semibold">{val}</span>{sub && <span className="ml-2 text-xs text-muted">{sub}</span>}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}
