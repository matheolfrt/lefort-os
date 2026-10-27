import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { Card, PageHeader, Stat } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/session";
import { MIN_SAMPLE, buildAdvice, eur, eur2, type Advice, type Ranked, type Verdict } from "@/lib/advisor";
import type { Facts } from "@/lib/advisor";
import { sellThroughAdvice, type SellThroughStats } from "@/lib/sellthrough";
import { Prioritize } from "./prioritize";

export const metadata = { title: "Conseils" };

const TONE: Record<Advice["tone"], { label: string; cls: string }> = {
  urgent: { label: "Urgent", cls: "bg-red-500/15 text-red-200 ring-red-400/40" },
  high: { label: "Important", cls: "bg-orange-400/15 text-orange-200 ring-orange-400/40" },
  normal: { label: "À faire", cls: "bg-accent/15 text-accent ring-accent/30" },
  info: { label: "Repère", cls: "bg-sky-400/15 text-sky-200 ring-sky-400/30" },
};
const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  buy: { label: "Acheter plus", cls: "bg-accent/15 text-accent" },
  slow: { label: "Rentable mais lent", cls: "bg-sky-400/15 text-sky-200" },
  avoid: { label: "À éviter", cls: "bg-red-500/15 text-red-200" },
  ok: { label: "Correct", cls: "bg-line/70 text-muted" },
  few: { label: "Peu de ventes", cls: "text-muted/70" },
};

export default async function Conseils() {
  await requireManager();
  const supabase = await createClient();
  const [{ data, error }, { data: org }, { data: st }] = await Promise.all([
    supabase.rpc("advisor_facts"),
    supabase.from("organizations").select("declaration_frequency").maybeSingle(),
    // missing until its migration has run: the page simply shows no sell-through advice
    supabase.rpc("sellthrough_stats"),
  ]);

  if (error || !data) {
    return (
      <div>
        <PageHeader title="Conseils" />
        <Card>
          {/advisor_facts|function/i.test(error?.message ?? "")
            ? "La mise à jour « 20261101000013_advisor.sql » n'a pas encore été exécutée dans Supabase (SQL Editor)."
            : error?.message ?? "Données indisponibles."}
        </Card>
      </div>
    );
  }

  const f = data as Facts;
  const r = buildAdvice(f, new Date(), org?.declaration_frequency === "quarterly");
  if (st) {
    // sell-through advice joins the lists by urgency: batches at risk are tasks, the rest is advice
    for (const a of sellThroughAdvice(st as SellThroughStats)) {
      (a.id.startsWith("st-risk") ? r.tasks : a.tone === "info" ? r.insights : r.advice).push(a);
    }
    r.tasks.sort((a, b) => b.score - a.score);
    r.advice.sort((a, b) => b.score - a.score);
    r.insights.sort((a, b) => b.score - a.score);
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Conseils"
        subtitle="Calculés à partir de vos ventes, de votre stock et de votre production. Pas d'IA : chaque conseil montre les chiffres d'où il vient." />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Marge moyenne / article" value={eur(r.reference.profitPerItemCents)} hint={`sur ${r.reference.sold} ventes, après frais et coût d'achat`} />
        <Stat label="Délai moyen de vente" value={r.reference.avgDays == null ? "—" : `${Math.round(r.reference.avgDays)} j`} hint="de la réception à la vente" />
        <Stat label="Stock payé non vendu" value={eur(f.stock.cost_cents)} hint={`${f.stock.n} articles`} />
        <Stat label="Stock dormant" value={eur(f.dormant.cost_cents)} hint={`${f.dormant.n} en ligne depuis + de ${f.dead_days} j`} />
      </div>

      <section aria-labelledby="todo">
        <h2 id="todo" className="eyebrow mb-2 text-highlight">À faire en priorité</h2>
        {r.tasks.length === 0 ? (
          <Card>Rien d&apos;urgent : la production et les expéditions sont à jour. 👌</Card>
        ) : (
          <ol className="space-y-2">
            {r.tasks.map((a, i) => <li key={a.id}><AdviceCard a={a} n={i + 1} /></li>)}
          </ol>
        )}
      </section>

      {r.advice.length > 0 && (
        <section aria-labelledby="money">
          <h2 id="money" className="eyebrow mb-2 text-highlight">Pour gagner plus</h2>
          <div className="space-y-2">{r.advice.map((a) => <AdviceCard key={a.id} a={a} />)}</div>
        </section>
      )}

      {r.insights.length > 0 && (
        <section aria-labelledby="facts">
          <h2 id="facts" className="eyebrow mb-2 text-highlight">Repères</h2>
          <div className="grid gap-2 md:grid-cols-2">{r.insights.map((a) => <AdviceCard key={a.id} a={a} compact />)}</div>
        </section>
      )}

      <section aria-labelledby="pays" className="space-y-3">
        <h2 id="pays" className="eyebrow text-highlight">Ce qui rapporte le plus</h2>
        <p className="text-sm text-muted">
          Classé par <strong className="text-fg">marge par jour de stock</strong> : la marge d&apos;un article divisée par le temps qu&apos;il a mis à se vendre.
          Un article à 20 € de marge vendu en 10 jours rapporte plus qu&apos;un article à 40 € vendu en 60 jours, car l&apos;argent revient plus vite.
          Repère : {eur(r.reference.profitPerItemCents)} par article en {r.reference.avgDays == null ? "—" : `${Math.round(r.reference.avgDays)} j`}.
        </p>
        <RankTable id="marques" title="Marques" rows={r.brands} />
        <RankTable id="categories" title="Catégories" rows={r.categories} />
        <RankTable id="tailles" title="Tailles" rows={r.sizes} />
        <RankTable id="prix" title="Prix de vente" rows={r.bands} noStock />
        {r.suppliers.length > 0 && (
          <Card title="Fournisseurs">
            <div className="overflow-x-auto">
              <table className="data">
                <thead><tr><th>Fournisseur</th><th className="num">Articles</th><th className="num">Vendus (%)</th><th className="num">Payé</th><th className="num">Bénéfice</th><th className="num">Retour</th></tr></thead>
                <tbody>
                  {[...r.suppliers].sort((a, b) => (b.roi_pct ?? -1e9) - (a.roi_pct ?? -1e9)).map((s) => (
                    <tr key={s.id}>
                      <td className="font-medium">{s.name}</td>
                      <td className="num">{s.items}</td>
                      <td className="num">{s.sell_through_pct == null ? "—" : `${Math.round(s.sell_through_pct)} %`}</td>
                      <td className="num">{eur(s.cost_cents)}</td>
                      <td className={`num ${s.profit_cents < 0 ? "text-red-300" : ""}`}>{eur(s.profit_cents)}</td>
                      <td className="num">{s.roi_pct == null ? "—" : `${Math.round(s.roi_pct)} %`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">Bénéfice et retour comptent tout ce qui a été payé au fournisseur, invendus compris.</p>
          </Card>
        )}
      </section>

      <details className="rounded-2xl border border-line bg-panel/60 p-4 text-sm text-muted">
        <summary className="cursor-pointer font-medium text-fg">Comment ces conseils sont calculés</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Marge d&apos;un article vendu = prix payé − frais Vinted, port et emballage payés par vous − coût d&apos;achat (part du lot).</li>
          <li>« Acheter plus » : au moins {MIN_SAMPLE} ventes, marge par article ≥ 120 % de votre moyenne, et vendu au moins aussi vite que la moyenne.
            « À éviter » : marge ≤ 40 % de la moyenne (ou négative), ou moins de 25 % écoulé avec 5 articles ou plus en stock.</li>
          <li>Stock dormant : en ligne depuis plus de {f.dead_days} jours (réglage « stock dormant » dans Paramètres). Prix conseillé : −15 %, jamais sous coût + frais + 1 €.</li>
          <li>Prix à perte : prix affiché − frais Vinted ({String(f.fee_pct).replace(".", ",")} % + {eur(f.fee_fixed_cents)}) − envoi moyen ({eur(f.ship_avg_cents)}) inférieur au coût d&apos;achat.</li>
          <li>Trop bon marché : prix affiché inférieur de 30 % au prix moyen de vente de la marque (au moins 3 ventes).</li>
          <li>Les priorités : expéditions en retard et déclaration URSSAF proche d&apos;abord, puis ce qui bloque des ventes (réservations, publication), puis la production.</li>
        </ul>
      </details>
    </div>
  );
}

function AdviceCard({ a, n, compact }: { a: Advice; n?: number; compact?: boolean }) {
  const t = TONE[a.tone];
  return (
    <article className="rounded-2xl border border-line bg-panel/80 p-4" data-advice={a.id}>
      <div className="flex flex-wrap items-start gap-3">
        {n != null && <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-panel-2 font-mono text-sm font-semibold">{n}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${t.cls}`}>{t.label}</span>
            <h3 className={`font-semibold ${compact ? "" : "text-[17px]"}`}>{a.title}</h3>
          </div>
          <p className="mt-1 text-sm text-fg/80">{a.detail}</p>
          {a.items && a.items.length > 0 && (
            <details className="group mt-2">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-accent">
                <ChevronDown size={15} className="transition group-open:rotate-180" /> {a.items.length} article{a.items.length > 1 ? "s" : ""}
              </summary>
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line text-sm">
                {a.items.map((it) => (
                  <li key={it.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                    <Link prefetch={false} href={`/stock/${encodeURIComponent(it.sku)}`} className="font-mono font-semibold hover:text-accent">{it.sku}</Link>
                    <span className="min-w-0 flex-1 truncate text-muted">{it.label}</span>
                    {it.extra && <span className="font-mono text-xs text-fg/85">{it.extra}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
          {a.impactCents != null && a.impactCents > 0 && (
            <div className="text-right">
              <div className="font-mono text-lg font-semibold">{eur(a.impactCents)}</div>
              {a.impactLabel && <div className="text-[11px] text-muted">{a.impactLabel}</div>}
            </div>
          )}
          {a.prioritize && a.items && <Prioritize ids={a.items.map((i) => i.id)} />}
          {a.href && (
            <Link href={a.href} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-line bg-panel-2 px-3 text-sm font-medium hover:border-fg/30">
              {a.hrefLabel ?? "Ouvrir"} <ArrowRight size={15} />
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

function RankTable({ id, title, rows, noStock }: { id: string; title: string; rows: Ranked[]; noStock?: boolean }) {
  if (!rows.length) return null;
  const top = rows.slice(0, 12);
  const rest = rows.slice(12);
  const row = (x: Ranked) => (
    <tr key={x.name}>
      <td className="font-medium">{x.name}</td>
      <td className="num">{x.sold}</td>
      <td className={`num ${(x.profitPerItemCents ?? 0) < 0 ? "text-red-300" : ""}`}>{eur(x.profitPerItemCents)}</td>
      <td className="num">{x.avgDays == null ? "—" : `${Math.round(x.avgDays)} j`}</td>
      <td className="num font-semibold">{eur2(x.profitPerDayCents)}</td>
      {!noStock && <td className="num">{x.sellThroughPct == null ? "—" : `${x.sellThroughPct} %`}</td>}
      {!noStock && <td className="num">{x.stock}</td>}
      <td><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${VERDICT[x.verdict].cls}`}>{VERDICT[x.verdict].label}</span></td>
    </tr>
  );
  return (
    <Card title={title} className="scroll-mt-20">
      <div id={id} className="overflow-x-auto">
        <table className="data">
          <thead><tr><th>{title.replace(/s$/, "")}</th><th className="num">Ventes</th><th className="num">Marge / art.</th><th className="num">Délai</th><th className="num">Marge / jour</th>{!noStock && <th className="num">Écoulé</th>}{!noStock && <th className="num">Stock</th>}<th>Verdict</th></tr></thead>
          <tbody>{top.map(row)}</tbody>
        </table>
        {rest.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-sm font-medium text-accent">Voir les {rest.length} autres</summary>
            <table className="data mt-1"><tbody>{rest.map(row)}</tbody></table>
          </details>
        )}
      </div>
    </Card>
  );
}
