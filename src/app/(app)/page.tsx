import Link from "next/link";
import { getContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PIPELINE, STATUS_LABEL, STATUS_TONE } from "@/i18n/fr";
import { Card, PageHeader, Stat, btn } from "@/components/ui";
import { daysSince, money } from "@/lib/format";
import { MICRO_TURNOVER_CEILING_CENTS, VAT_FRANCHISE_THRESHOLD_CENTS } from "@/lib/compliance";
import type { ItemStatus } from "@/lib/types";

export default async function Dashboard() {
  const ctx = await getContext();
  const supabase = await createClient();
  const year = new Date().getFullYear();

  const [{ data: pipeline }, { data: toShip }, { data: turnover }] = await Promise.all([
    supabase.from("v_pipeline").select("*"),
    supabase.rpc("shipping_queue"),
    ctx.isManager
      ? supabase.from("v_monthly_turnover").select("*").gte("month", `${year}-01-01`).order("month")
      : Promise.resolve({ data: [] as { month: string; turnover_cents: number; contributions_cents: number }[] }),
  ]);

  const counts = new Map<ItemStatus, { items: number; oldest_since: string }>(
    (pipeline ?? []).map((p) => [p.status as ItemStatus, p]),
  );
  const shipOrders = new Map<string, string>((toShip ?? []).map((r: { order_id: string; sold_at: string }) => [r.order_id, r.sold_at]));
  const oldestSale = [...shipOrders.values()].sort()[0];
  const ytd = (turnover ?? []).reduce((s, m) => s + Number(m.turnover_cents), 0);
  const thisMonth = (turnover ?? []).at(-1);
  const onHold = counts.get("on_hold")?.items ?? 0;

  return (
    <>
      <PageHeader title="Tableau de bord" subtitle={new Date().toLocaleDateString("fr-FR", { dateStyle: "full" })} />

      {shipOrders.size > 0 && (
        <Link
          href="/postes/expedition"
          className={`mb-4 flex items-center justify-between rounded-lg p-4 font-semibold ${
            daysSince(oldestSale) >= 1 ? "bg-red-600 text-white" : "bg-orange-200 text-orange-950"
          }`}
        >
          <span>
            {shipOrders.size} commande{shipOrders.size > 1 ? "s" : ""} à expédier
            {daysSince(oldestSale) >= 1 && ` — la plus ancienne depuis ${daysSince(oldestSale)} j`}
          </span>
          <span>Expédier →</span>
        </Link>
      )}

      <Card title="Chaîne de production" className="mb-4">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          {PIPELINE.map((s) => {
            const c = counts.get(s);
            const age = c ? daysSince(c.oldest_since) : 0;
            return (
              <Link key={s} href={`/stock?status=${s}`} className={`rounded-md p-3 ${STATUS_TONE[s]} hover:brightness-95`}>
                <div className="text-[11px] font-semibold uppercase leading-tight">{STATUS_LABEL[s]}</div>
                <div className="mt-1 text-3xl font-black tabular-nums">{c?.items ?? 0}</div>
                <div className="text-[11px] opacity-70">{c && s !== "listed" ? `plus ancien : ${age} j` : " "}</div>
              </Link>
            );
          })}
        </div>
        {onHold > 0 && (
          <Link href="/stock?status=on_hold" className="mt-3 inline-block text-sm font-semibold text-yellow-700 underline">
            {onHold} article{onHold > 1 ? "s" : ""} en attente (retouche, nettoyage…)
          </Link>
        )}
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link href="/postes" className={`${btn.huge} col-span-2 md:col-span-1`}>Ouvrir un poste</Link>
        <Stat label="En ligne" value={counts.get("listed")?.items ?? 0} />
        {ctx.isManager && (
          <>
            <Stat label="CA du mois" value={money(thisMonth ? Number(thisMonth.turnover_cents) : 0)} hint="encaissé" />
            <Stat
              label={`CA ${year}`}
              value={money(ytd)}
              hint={`URSSAF estimée : ${money((turnover ?? []).reduce((s, m) => s + Number(m.contributions_cents), 0))}`}
            />
          </>
        )}
      </div>

      {ctx.isManager && (
        <Card title="Seuils micro-entreprise">
          <Gauge label="Franchise de TVA" value={ytd} max={VAT_FRANCHISE_THRESHOLD_CENTS} />
          <Gauge label="Plafond micro-entreprise" value={ytd} max={MICRO_TURNOVER_CEILING_CENTS} />
        </Card>
      )}
    </>
  );
}

function Gauge({ label, value, max }: { label: string; value: number; max: number }) {
  const ratio = Math.min(1, value / max);
  const tone = ratio >= 0.95 ? "bg-red-600" : ratio >= 0.8 ? "bg-orange-500" : "bg-emerald-600";
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted">
          {money(value)} / {money(max)} ({Math.round(ratio * 100)} %)
        </span>
      </div>
      <div className="h-2 rounded bg-line">
        <div className={`h-2 rounded ${tone}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
