import Link from "next/link";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageHeader, Stat } from "@/components/ui";
import { LOW_SAMPLE, returnsLoss, type ReturnStats } from "@/lib/dashboard";
import { money } from "@/lib/format";
import { addDays, parisDay } from "@/lib/trend";

export const metadata = { title: "Retours" };

const PERIODS = [
  { key: "90", label: "3 mois", days: 90 },
  { key: "365", label: "12 mois", days: 365 },
  { key: "tout", label: "Depuis le début", days: null },
] as const;
const rate = (returned: number, sold: number) => (sold ? (returned * 100) / sold : 0);
const pct = (v: number) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: v < 10 ? 1 : 0 })} %`;
const dateLong = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Returns: how many sales come back, what they cost, and where they come from (size, brand, reason) */
export default async function Returns({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  await requireManager();
  const sp = await searchParams;
  const period = PERIODS.find((x) => x.key === sp.p) ?? PERIODS[1];
  const today = parisDay(new Date());
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("return_stats", { p_from: period.days ? addDays(today, -period.days) : "2000-01-01", p_to: today });
  if (error || !data) {
    return (
      <>
        <PageHeader title="Retours" back="/ventes" />
        <Empty action={{ href: "/parametres/mises-a-jour", label: "Mettre à jour la base" }}>Cette page a besoin d&apos;une mise à jour de la base de données.</Empty>
      </>
    );
  }
  const r = data as ReturnStats;
  const overall = rate(r.returned, r.sold);
  const loss = returnsLoss(r);

  return (
    <>
      <PageHeader title="Retours" back="/ventes"
        subtitle={period.days ? `Ventes du ${dateLong(r.from)} au ${dateLong(r.to)}` : "Toutes les ventes"} />

      <nav aria-label="Période" className="mb-4 flex flex-wrap gap-2">
        {PERIODS.map((x) => (
          <Link key={x.key} href={`/ventes/retours?p=${x.key}`} aria-current={x.key === period.key ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium ring-1 ring-inset transition ${
              x.key === period.key ? "bg-fg text-bg ring-fg" : "ring-line hover:ring-fg/30"}`}>
            {x.label}
          </Link>
        ))}
      </nav>

      {!r.sold ? <Empty>Aucune vente sur cette période.</Empty> : (
        <div className="space-y-4" data-testid="returns">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Taux de retour" value={pct(overall)} hint={`${r.returned} retour${r.returned > 1 ? "s" : ""} sur ${r.sold} ventes`}
              help="Part des ventes de la période revenues en retour (l'article est revenu et a été remboursé)." />
            <Stat label="Remboursé" value={money(r.refunded_cents)} hint="rendu aux acheteurs pour les retours"
              help="Le prix des articles revenus, rendu aux acheteurs. Ce n'est pas une perte en soi : l'article revient en stock et se revend." />
            <Stat label="Perdu" value={money(loss)} hint="frais, revente moins chère, gestes"
              help="Ce que les retours ont vraiment coûté : voir le détail à côté. Le port du retour, quand vous le payez, n'est pas enregistré dans Lefort OS et n'est donc pas compté." />
            <Stat label="Revendus" value={`${r.resold} / ${r.returned}`} hint="articles revenus et revendus" />
          </div>

          <Card title="Ce que les retours ont coûté">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[1fr_auto]" data-testid="returns-loss">
              <dt>Frais Vinted, port et emballage des ventes revenues <span className="text-muted">(payés pour rien)</span></dt>
              <dd className="text-right font-mono tabular-nums">{money(r.lost_fees_cents)}</dd>
              <dt>Revente moins chère <span className="text-muted">({r.resold} article{r.resold > 1 ? "s" : ""} revendu{r.resold > 1 ? "s" : ""})</span></dt>
              <dd className="text-right font-mono tabular-nums">{money(r.resale_loss_cents)}</dd>
              <dt>Remboursements sans retour <span className="text-muted">(gestes commerciaux : {r.goodwill_n})</span></dt>
              <dd className="text-right font-mono tabular-nums">{money(r.goodwill_cents)}</dd>
              <dt className="border-t border-line pt-2 font-semibold">Total perdu</dt>
              <dd className="border-t border-line pt-2 text-right font-mono font-semibold tabular-nums">{money(loss)}</dd>
            </dl>
            <p className="mt-3 text-xs text-muted">Le port du retour, quand c&apos;est vous qui le payez, n&apos;est pas enregistré : il n&apos;est pas compté.</p>
          </Card>

          {r.returned > 0 ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <Breakdown title="Par taille" rows={r.by_size} overall={overall} testid="by-size" />
              <Breakdown title="Par marque" rows={r.by_brand} overall={overall} testid="by-brand" />
              <Card title="Par motif">
                <ul className="divide-y divide-line text-sm" data-testid="by-reason">
                  {r.by_reason.map((x) => (
                    <li key={x.label} className="flex justify-between gap-3 py-2"><span>{x.label}</span><span className="font-mono tabular-nums">{x.n}</span></li>
                  ))}
                </ul>
              </Card>
            </div>
          ) : <Empty>Aucun retour sur cette période.</Empty>}
        </div>
      )}
    </>
  );
}

/** Sizes or brands with at least one return; « à surveiller » when clearly above the overall rate with enough sales */
function Breakdown({ title, rows, overall, testid }: {
  title: string; rows: { label: string; sold: number; returned: number }[]; overall: number; testid: string;
}) {
  return (
    <Card title={title}>
      <div className="overflow-x-auto">
        <table className="data" data-testid={testid}>
          <thead><tr><th>{title.replace("Par ", "").replace(/^./, (c) => c.toUpperCase())}</th><th className="num">Ventes</th><th className="num">Retours</th><th className="num">Taux</th></tr></thead>
          <tbody>
            {rows.map((x) => {
              const v = rate(x.returned, x.sold);
              const watch = x.returned >= 2 && v >= overall * 1.5;
              return (
                <tr key={x.label} data-watch={watch || undefined}>
                  <td>
                    {x.label}
                    {watch && <span className="ml-2 rounded bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">à surveiller</span>}
                  </td>
                  <td className="num">{x.sold}</td>
                  <td className="num">{x.returned}</td>
                  <td className="num">{pct(v)}{x.sold < LOW_SAMPLE && <span className="ml-1 text-[10px] text-muted" title="Peu de ventes : à prendre avec prudence">n={x.sold}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
