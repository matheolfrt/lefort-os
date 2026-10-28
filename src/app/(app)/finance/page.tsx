import Link from "next/link";
import { ArrowRight, FlaskConical, Settings2 } from "lucide-react";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, PageHeader, btn } from "@/components/ui";
import { loadFinance } from "@/lib/finance/server";
import { MIN_SEGMENT_SALES, evolution, euro, frDate, frShort, insights, liquidationValue, pct, type Segment } from "@/lib/finance";
import { Kpi, LevelBadge, Section, Trend } from "@/components/finance/kpi";
import { Explain } from "@/components/finance/explain";
import { CapitalMap } from "@/components/finance/capital-map";
import { ForecastChart } from "@/components/finance/forecast-chart";

export const metadata = { title: "Où est mon argent ?" };

const DIMS = [
  { key: "category", label: "Catégories" }, { key: "brand", label: "Marques" }, { key: "supplier", label: "Fournisseurs" },
  { key: "size", label: "Tailles" }, { key: "material", label: "Matières" }, { key: "platform", label: "Plateformes" },
] as const;
const PERIODS = [{ key: "90", label: "90 j" }, { key: "365", label: "12 mois" }, { key: "tout", label: "Tout" }] as const;
const SORTS = [
  { key: "capital", label: "Capital immobilisé" }, { key: "ca", label: "CA" }, { key: "marge", label: "Marge" }, { key: "roi", label: "ROI" },
] as const;

interface DormantRow {
  id: string; sku: string; title: string | null; brand: string | null; category: string | null; cost_cents: number;
  price_cents: number | null; age: number; suggested_cents: number | null; suggest_todo: boolean | null;
}

const times = (v: number | null, d = 2) => (v == null ? "—" : `${v.toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d })}×`);
const days = (v: number | null) => (v == null ? "—" : `${Math.round(v)} j`);
const TONE = {
  alert: "border-red-400/30 bg-red-500/[0.07]", warn: "border-amber-400/30 bg-amber-400/[0.06]",
  good: "border-accent/30 bg-accent/[0.06]", info: "border-line bg-panel/60",
} as const;
const AGE_COLOR = ["#199e70", "#3987e5", "#9085e9", "#d95926"];

export default async function Finance({ searchParams }: { searchParams: Promise<{ axe?: string; periode?: string; tri?: string }> }) {
  await requireManager();
  const sp = await searchParams;
  const f = await loadFinance({ snapshot: true });
  if (!f) {
    return (
      <>
        <PageHeader title="Où est mon argent ?" />
        <Empty action={{ href: "/parametres/mises-a-jour", label: "Mettre à jour la base" }}>Cette page a besoin d&apos;une mise à jour de la base de données.</Empty>
      </>
    );
  }
  const { o, today, cash, cap, perf, turn, fc, budget, immob } = f;
  const s = o.settings;
  const axe = DIMS.some((d) => d.key === sp.axe) ? sp.axe! : "category";
  const periode = PERIODS.some((p) => p.key === sp.periode) ? sp.periode! : "365";
  const tri = SORTS.some((t) => t.key === sp.tri) ? sp.tri! : "capital";
  const segDays = periode === "tout" ? null : Number(periode);

  const supabase = await createClient();
  const seg = (dim: string, d: number | null = 365) => supabase.rpc("finance_segments", { p_dim: dim, p_days: d }).then((r) => (r.data ?? []) as Segment[]);
  const [brands, categories, sizes, table, dormantRes] = await Promise.all([
    seg("brand"), seg("category"), seg("size"), seg(axe, segDays),
    supabase.rpc("finance_items", { p_view: "dormant", p_sort: "cost", p_limit: 5 }),
  ]);
  const dormant = ((dormantRes.data as { rows?: DormantRow[] } | null)?.rows ?? []);
  const bi = insights({ o, cap, perf, turn, fc, budget, today, brands, categories, sizes });
  const evo = evolution(o, cap.total, today);
  const liquidation = liquidationValue(o.stock.price_cents, o.stock.unpriced_cost_cents, s.liquidation_pct);
  const stockShareDormant = o.stock.cost_cents ? (o.stock.dormant_cost_cents * 100) / o.stock.cost_cents : null;
  const capShareDormant = cap.total ? (o.stock.dormant_cost_cents * 100) / cap.total : null;
  const realAvailable = (cash.known ? cash.cents ?? 0 : 0) + o.receivable.amount_cents - budget.due30 - budget.committed;
  const at30 = fc.marks.find((m) => m.days === 30);
  const sorted = [...table].sort((a, b) => {
    const roi = (x: Segment) => (x.sold_cost_cents > 0 ? x.margin_cents / x.sold_cost_cents : -Infinity);
    return tri === "ca" ? b.revenue_cents - a.revenue_cents : tri === "marge" ? b.margin_cents - a.margin_cents
      : tri === "roi" ? roi(b) - roi(a) : b.stock_cost_cents - a.stock_cost_cents;
  });
  const segHref = (p: Record<string, string>) => `/finance?${new URLSearchParams({ axe, periode, tri, ...p })}#segments`;
  const stale = cash.staleDays != null && cash.staleDays > 30;

  return (
    <div className="space-y-8">
      <PageHeader title="Où est mon argent ?"
        subtitle={`Calculé à partir de vos données, le ${frDate(today)}. Chaque chiffre est cliquable et dit comment il est calculé.`}
        actions={<Link href="/finance/parametres" prefetch={false} className={btn.secondary}><Settings2 size={16} /> Paramètres financiers</Link>} />

      <nav aria-label="Sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 text-sm [scrollbar-width:none]">
        {[["capital", "Capital"], ["stock", "Stock"], ["performance", "Performance"], ["rotation", "Rotation"], ["prevision", "Trésorerie"],
          ["budget", "Budget d'achat"], ["recommandations", "Recommandations"], ["segments", "Analyse"]].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-line bg-panel/60 px-3 text-muted transition hover:border-fg/25 hover:text-fg">{label}</a>
        ))}
      </nav>

      {!cash.known && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/[0.07] p-4 text-sm">
          <p><strong className="font-semibold">Trésorerie non déclarée.</strong> <span className="text-muted">Saisissez le solde de votre compte une fois : ensuite, les ventes, achats et charges le mettent à jour.</span></p>
          <Link href="/finance/parametres#tresorerie" prefetch={false} className={btn.primary}>Déclarer mon solde</Link>
        </div>
      )}

      {/* the figures that matter first, in the order they matter on a phone */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="fcc-top">
        <Kpi label="Trésorerie" value={cash.known ? euro(cash.cents) : "—"} href="/finance/parametres#tresorerie"
          sub={cash.known ? `Solde du ${frShort(cash.asOf!)} + mouvements depuis${stale ? " · à revérifier" : ""}` : "Non déclarée : déclarez votre solde"}
          lines={cash.lines} />
        <Kpi label="Capital total" value={euro(cap.total)} href="#capital" lines={cap.lines}
          delta={evo ? { pct: evo.pct, text: `depuis le ${frShort(evo.since)}` } : null}
          sub={evo ? undefined : "L'évolution apparaîtra avec l'historique (un relevé par jour)"} />
        <Kpi label="Stock au coût" value={euro(o.stock.cost_cents)} href="/finance/articles?vue=stock"
          sub={`${o.stock.count} articles · ${euro(o.stock.price_cents)} au prix affiché`} />
        <Kpi label="Capital immobilisé" value={immob.share == null ? "—" : pct(immob.share, 0)} badge={<LevelBadge level={immob.level} />}
          href="#stock" sub={`du capital est en stock (seuils ${s.immob_levels.normal} / ${s.immob_levels.high} / ${s.immob_levels.critical} %)`}
          lines={[{ label: "Stock au coût", value: euro(o.stock.cost_cents) }, { label: "Capital total", value: euro(cap.total), op: "÷" }, { label: "Part immobilisée", value: pct(immob.share), op: "=" }]} />
        <Kpi label="Stock dormant" value={euro(o.stock.dormant_cost_cents)} href="/finance/articles?vue=dormant"
          sub={`${o.stock.dormant_count} article${o.stock.dormant_count > 1 ? "s" : ""} de plus de ${s.dead_stock_days} j · ${pct(stockShareDormant, 0)} du stock`} />
        <Kpi label="Budget d'achat" value={budget.known ? euro(budget.recommended) : "—"} href="#budget"
          sub={budget.known ? `recommandé · maximum ${euro(budget.max)}` : "Déclarez votre trésorerie"} />
        <Kpi label="Trésorerie à J+30" value={at30 ? euro(at30.base) : "—"} href="#prevision"
          sub={at30 ? `prévision, entre ${euro(at30.low)} et ${euro(at30.high)}${cash.known ? "" : " (variation depuis 0)"}` : undefined} />
        <Kpi label={`Bénéfice ${perf.days} j`} value={euro(perf.net)} href="#performance"
          delta={perf.prevRevenue ? { pct: ((perf.revenue - perf.prevRevenue) * 100) / perf.prevRevenue, text: "de CA vs période précédente" } : null}
          sub={`sur ${euro(perf.revenue)} de CA`} />
      </div>

      <Section id="capital" n={1} title="Vue d'ensemble du capital"
        aside={evo && <Trend pct={evo.pct} text={`${evo.delta >= 0 ? "+" : "−"}${euro(Math.abs(evo.delta))} depuis le ${frShort(evo.since)}`} />}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="rounded-2xl border border-line bg-panel/80 p-4">
            <CapitalMap parts={cap.parts} total={cap.total} cashKnown={cap.cashKnown} />
            <Explain lines={cap.lines} note="Le stock dormant fait partie du stock : il est montré à part pour voir l'argent qui ne tourne plus. Les articles écartés (invendables) ne comptent plus." />
          </div>
          <div className="grid content-start gap-2">
            <Kpi label="Valeur du stock si vendu vite" value={euro(liquidation)} href="/finance/parametres#seuils"
              sub={`prix affichés × ${s.liquidation_pct} %, coût pour les articles sans prix`}
              lines={[
                { label: `Prix affichés (${o.stock.priced_count} articles)`, value: euro(o.stock.price_cents) },
                { label: "Facteur de liquidation", value: `${s.liquidation_pct} %`, op: "×" },
                { label: `Articles sans prix, au coût (${o.stock.unpriced_count})`, value: euro(o.stock.unpriced_cost_cents), op: "+" },
                { label: "Valeur de liquidation", value: euro(liquidation), op: "=" },
              ]} />
            {o.rejected.count > 0 && (
              <p className="rounded-xl border border-line bg-panel/60 p-3 text-xs text-muted">
                {o.rejected.count} article{o.rejected.count > 1 ? "s" : ""} écarté{o.rejected.count > 1 ? "s" : ""} : {euro(o.rejected.cost_cents)} d&apos;achat perdus, non comptés dans le capital.
              </p>
            )}
          </div>
        </div>
      </Section>

      <Section id="stock" n={2} title="Stock et capital immobilisé">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Kpi label="Au coût d'achat" value={euro(o.stock.cost_cents)} href="/finance/articles?vue=stock" sub={`${o.stock.count} articles en stock`} />
          <Kpi label="Au prix affiché" value={euro(o.stock.price_cents)} href="/finance/articles?vue=stock&tri=price"
            sub={o.stock.unpriced_count ? `${o.stock.unpriced_count} sans prix non comptés` : "tous les articles ont un prix"} />
          <Kpi label="Valeur de liquidation" value={euro(liquidation)} sub={`facteur ${s.liquidation_pct} %`} />
          <Kpi label="Sans prix" value={String(o.stock.unpriced_count)} href="/finance/articles?vue=unpriced" sub={`${euro(o.stock.unpriced_cost_cents)} au coût`} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-line bg-panel/80 p-4">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">Âge du stock</h3>
              <span className="text-xs text-muted">depuis la {s.aging_basis === "listed" ? "mise en ligne" : "réception"}</span>
            </div>
            <ul className="space-y-1">
              {o.stock.aging.map((b, i) => {
                const share = o.stock.cost_cents ? (b.cost_cents * 100) / o.stock.cost_cents : 0;
                const label = b.to == null ? `Plus de ${b.from - 1} j` : `${b.from} – ${b.to} j`;
                return (
                  <li key={label}>
                    <Link prefetch={false} href={`/finance/articles?vue=age&min=${b.from}${b.to == null ? "" : `&max=${b.to}`}`} data-age={label}
                      className="group grid min-h-11 grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 transition hover:bg-fg/5">
                      <span className="text-sm">{label}</span>
                      <span className="h-2.5 overflow-hidden rounded-full bg-line/60">
                        <span className="block h-full rounded-full" style={{ width: `${Math.max(share, b.cost_cents ? 1 : 0)}%`, background: AGE_COLOR[i] }} />
                      </span>
                      <span className="text-right font-mono text-sm tabular-nums">
                        {euro(b.cost_cents)} <span className="text-xs text-muted">· {b.count} · {Math.round(share)} %</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <Explain lines={[
              { label: "Âge = aujourd'hui − date de " + (s.aging_basis === "listed" ? "mise en ligne (réception si jamais publié)" : "réception"), value: "" },
              { label: "Montant = coût d'achat des articles de la tranche", value: "" },
              { label: `Tranches réglables ; la dernière commence au seuil du stock dormant (${s.dead_stock_days} j)`, value: "", muted: true },
            ]} />
          </div>

          <div className="rounded-2xl border border-line bg-panel/80 p-4" data-testid="dead-stock">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">Stock dormant <span className="text-muted">(plus de {s.dead_stock_days} j)</span></h3>
              <Link prefetch={false} href="/finance/articles?vue=dormant" className="inline-flex min-h-11 items-center gap-1 text-sm text-accent hover:underline">
                Voir les articles <ArrowRight size={14} />
              </Link>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Mini k="Montant" v={euro(o.stock.dormant_cost_cents)} />
              <Mini k="Articles" v={String(o.stock.dormant_count)} />
              <Mini k="Du stock" v={pct(stockShareDormant, 0)} />
              <Mini k="Du capital" v={pct(capShareDormant, 0)} />
            </div>
            {dormant.length > 0 ? (
              <ul className="mt-3 divide-y divide-line text-sm">
                {dormant.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
                    <Link prefetch={false} href={`/stock/${encodeURIComponent(d.sku)}`} className="font-mono font-semibold hover:text-accent">{d.sku}</Link>
                    <span className="min-w-0 flex-1 truncate text-muted">{[d.brand, d.category].filter(Boolean).join(" · ") || d.title}</span>
                    <span className="font-mono text-xs tabular-nums text-muted">{d.age} j</span>
                    <span className="font-mono tabular-nums">{euro(d.cost_cents)}</span>
                    {d.suggest_todo && d.suggested_cents != null && d.price_cents != null && (
                      <Link prefetch={false} href="/prix" className="w-full text-xs text-amber-300 hover:underline sm:w-auto">
                        Prix suggéré {euro(d.suggested_cents)} au lieu de {euro(d.price_cents)}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm text-muted">Aucun article dormant : tout votre stock a moins de {s.dead_stock_days} jours.</p>}
            <p className="mt-2 text-xs text-muted">
              Les baisses de prix restent des suggestions (règles de la page <Link prefetch={false} href="/prix" className="underline hover:text-fg">Prix</Link>) : rien ne change sans vous.
              Vues, favoris et offres Vinted ne sont pas encore enregistrés.
            </p>
          </div>
        </div>
      </Section>

      <Section id="performance" n={3} title={`Performance · ${perf.days} derniers jours`}
        aside={<Link prefetch={false} href={`/finance/ventes?jours=${perf.days}`} className="inline-flex min-h-11 items-center gap-1 text-sm text-accent hover:underline">Voir les ventes <ArrowRight size={14} /></Link>}>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Kpi label="Chiffre d'affaires" value={euro(perf.revenue)} href={`/finance/ventes?jours=${perf.days}`}
            delta={perf.prevRevenue ? { pct: ((perf.revenue - perf.prevRevenue) * 100) / perf.prevRevenue, text: `vs ${perf.days} j précédents` } : null}
            sub={`${perf.items} article${perf.items > 1 ? "s" : ""} vendu${perf.items > 1 ? "s" : ""}`} />
          <Kpi label="Marge brute" value={euro(perf.gross)} sub={perf.grossPct == null ? "—" : `${pct(perf.grossPct)} du CA`}
            delta={perf.prevGross ? { pct: ((perf.gross - perf.prevGross) * 100) / Math.abs(perf.prevGross), text: `vs ${perf.days} j précédents` } : null}
            lines={perf.lines.slice(0, 4)} />
          <Kpi label="Bénéfice" value={euro(perf.net)} sub={perf.netPct == null ? "—" : `${pct(perf.netPct)} du CA, après cotisations et charges`} lines={perf.lines} />
          <Kpi label="Charges et cotisations" value={euro(perf.charges + perf.contributions)}
            sub={`dont cotisations ${euro(perf.contributions)}`} href="/finance/parametres#charges"
            lines={[{ label: "Cotisations estimées", value: euro(perf.contributions) }, ...perf.chargeLines.map((l) => ({ ...l, op: "+" as const })),
              { label: "Total", value: euro(perf.charges + perf.contributions), op: "=" }]} />
        </div>
      </Section>

      <Section id="rotation" n={4} title="Rotation et rendement du capital">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Kpi label="Rotation mensuelle" value={times(turn.monthly)} sub="fois que le stock est vendu par mois" lines={turn.lines} />
          <Kpi label="Rotation annuelle" value={times(turn.yearly, 1)} sub={turn.yearlyMeasured ? "mesurée sur 12 mois" : `projetée depuis les ${turn.days} derniers jours`} />
          <Kpi label="Immobilisation moyenne" value={days(turn.daysOfStock)} sub="durée pour écouler le stock au rythme actuel"
            lines={turn.lines} />
          <Kpi label="Valeur consommée" value={euro(turn.cogs)} sub={`stock au coût vendu en ${turn.days} j`} href={`/finance/ventes?jours=${turn.days}`} />
          <Kpi label="Vélocité du capital" value={turn.velocity == null ? "—" : `${turn.velocity.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €`}
            sub="de marge par an pour 1 € de stock" lines={turn.velocityLines} />
          <Kpi label="Retour sur capital" value={turn.roc == null ? "—" : pct(turn.roc, 0)} sub="bénéfice annualisé / capital" lines={turn.rocLines} />
        </div>
      </Section>

      <Section id="prevision" n={5} title="Trésorerie et prévision"
        aside={<Link prefetch={false} href="/scenarios" className="inline-flex min-h-11 items-center gap-1 text-sm text-accent hover:underline"><FlaskConical size={14} /> Scénarios</Link>}>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Kpi label="Trésorerie actuelle" value={cash.known ? euro(cash.cents) : "—"} href="/finance/parametres#tresorerie" lines={cash.lines}
            sub={cash.known ? `${stale ? "Dernier solde déclaré il y a " + cash.staleDays + " j · " : ""}compte + mouvements enregistrés` : "non déclarée"} />
          <Kpi label="Encaissements attendus" value={euro(o.receivable.amount_cents)} href="/finance/a-recevoir"
            sub={`${o.receivable.count} vente${o.receivable.count > 1 ? "s" : ""} pas encore versée${o.receivable.count > 1 ? "s" : ""}`} />
          <Kpi label="Dépenses prévues 30 j" value={euro(budget.due30 + budget.committed)} href="/finance/parametres#charges"
            sub={`charges et cotisations ${euro(budget.due30)} · achats engagés ${euro(budget.committed)}`} />
          <Kpi label="Disponible réel" value={cash.known ? euro(realAvailable) : "—"}
            sub={cash.known ? `dont réserve de sécurité ${euro(s.cash_reserve_cents)} à ne pas dépenser` : "déclarez votre trésorerie"}
            lines={[
              { label: "Trésorerie", value: cash.known ? euro(cash.cents) : "—" },
              { label: "Encaissements attendus", value: euro(o.receivable.amount_cents), op: "+" },
              { label: "Dépenses prévues sur 30 j", value: euro(budget.due30), op: "−" },
              { label: "Achats déjà engagés", value: euro(budget.committed), op: "−" },
              { label: "Disponible réel", value: euro(realAvailable), op: "=" },
            ]} />
        </div>

        <div className="rounded-2xl border border-line bg-panel/80 p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">Prévision de trésorerie · {fc.points.length - 1} jours</h3>
            <span className="text-xs text-amber-300">Estimation, pas une certitude</span>
          </div>
          <ForecastChart points={fc.points} reserve={s.cash_reserve_cents} known={cash.known} />
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="forecast-marks">
            {fc.marks.filter((m) => [7, 30, 60, 90].includes(m.days)).map((m) => (
              <div key={m.days} className="rounded-xl border border-line bg-bg/40 p-3">
                <div className="eyebrow-tight text-muted">J+{m.days}</div>
                <div className={`font-mono text-lg font-semibold tabular-nums ${cash.known && m.base < s.cash_reserve_cents ? "text-red-300" : ""}`}>{euro(m.base)}</div>
                <div className="font-mono text-[11px] tabular-nums text-muted">{euro(m.low)} – {euro(m.high)}</div>
              </div>
            ))}
          </div>
          {(fc.belowReserve.base || fc.belowReserve.low) && (
            <p className="mt-3 rounded-xl border border-red-400/30 bg-red-500/[0.07] p-3 text-sm">
              {fc.belowReserve.base ? `Au rythme actuel, la trésorerie passerait sous la réserve le ${frDate(fc.belowReserve.base)}.`
                : `Si les ventes baissent de 25 %, la trésorerie passerait sous la réserve le ${frDate(fc.belowReserve.low!)}.`}
            </p>
          )}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="eyebrow-tight mb-1.5 text-muted">Hypothèses</h4>
              <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted">{fc.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
              <Link prefetch={false} href="/finance/parametres#prevision" className="mt-2 inline-flex min-h-11 items-center gap-1 text-xs text-accent hover:underline">Modifier les hypothèses <ArrowRight size={12} /></Link>
            </div>
            <div>
              <h4 className="eyebrow-tight mb-1.5 text-muted">Sorties prévues sur {fc.points.length - 1} j</h4>
              {fc.outflows.length ? (
                <ul className="divide-y divide-line text-sm">
                  {fc.outflows.map((x) => <li key={x.label} className="flex justify-between py-1.5"><span>{x.label}</span><span className="font-mono tabular-nums">{euro(x.cents)}</span></li>)}
                </ul>
              ) : <p className="text-xs text-muted">Aucune charge récurrente ni achat prévu. <Link prefetch={false} href="/finance/parametres#charges" className="underline">Ajouter vos charges</Link> rend la prévision plus juste.</p>}
            </div>
          </div>
        </div>
      </Section>

      <Section id="budget" n={6} title="Budget d'achat">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="grid content-start gap-2">
            <Kpi big label="Budget recommandé" value={budget.known ? euro(budget.recommended) : "—"} sub={budget.reason} lines={budget.lines}
              note="La réserve de sécurité n'est jamais comptée comme dépensable." />
            <div className="grid grid-cols-2 gap-2">
              <Kpi label="Maximum" value={budget.known ? euro(budget.max) : "—"} sub="sans toucher la réserve" />
              <Kpi label="Déjà engagé" value={euro(budget.committed)} href="/finance/parametres#achats" sub={`${o.planned.length} achat${o.planned.length > 1 ? "s" : ""} prévu${o.planned.length > 1 ? "s" : ""}`} />
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-panel/80 p-4 text-sm">
            <h3 className="mb-2 font-medium">Ce qui entre dans le calcul</h3>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5">
              <dt className="text-muted">Réserve de sécurité (jamais dépensable)</dt><dd className="text-right font-mono tabular-nums">{euro(s.cash_reserve_cents)}</dd>
              <dt className="text-muted">Dépenses prévues sur 30 j</dt><dd className="text-right font-mono tabular-nums">{euro(budget.due30)}</dd>
              <dt className="text-muted">Achats prévus</dt><dd className="text-right font-mono tabular-nums">{euro(budget.committed)}</dd>
              <dt className="text-muted">Charges récurrentes</dt><dd className="text-right font-mono tabular-nums">{o.recurring.length}</dd>
              <dt className="text-muted">Ventes prévues (coût vendu par jour)</dt><dd className="text-right font-mono tabular-nums">{fc.itemsPerDay.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} art./j</dd>
              <dt className="text-muted">Stock visé</dt><dd className="text-right font-mono tabular-nums">30 + {s.forecast.stock_target_days} j</dd>
              <dt className="text-muted">Stock actuel couvre</dt><dd className="text-right font-mono tabular-nums">{days(budget.coverDays)}</dd>
            </dl>
            {o.planned.length > 0 && (
              <ul className="mt-3 divide-y divide-line border-t border-line">
                {o.planned.map((p) => (
                  <li key={p.id} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                    <span>{p.label}{p.supplier && <span className="text-muted"> · {p.supplier}</span>}</span>
                    <span className="font-mono tabular-nums">{euro(p.amount_cents)} <span className="text-xs text-muted">le {frShort(p.due_on)}</span></span>
                  </li>
                ))}
              </ul>
            )}
            <Link prefetch={false} href="/finance/parametres#achats" className="mt-2 inline-flex min-h-11 items-center gap-1 text-accent hover:underline">Gérer les achats prévus et la réserve <ArrowRight size={14} /></Link>
          </div>
        </div>
      </Section>

      <Section id="recommandations" n={7} title="Recommandations">
        {bi.list.length > 0 ? (
          <ul className="grid gap-2 md:grid-cols-2" data-testid="insights">
            {bi.list.map((i) => (
              <li key={i.id} data-insight={i.id} className={`flex flex-col rounded-2xl border p-4 ${TONE[i.tone]}`}>
                <p className="text-sm leading-relaxed"><span aria-hidden className="mr-1.5">{i.icon}</span>{i.text}</p>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
                  <span className="text-[11px] text-muted">Basé sur : {i.basis}</span>
                  {i.href && <Link prefetch={false} href={i.href} className="inline-flex min-h-10 items-center gap-1 text-xs text-accent hover:underline">Voir <ArrowRight size={12} /></Link>}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Pas assez de données pour établir une recommandation fiable.</p>}
        {bi.missing.length > 0 && (
          <div className="rounded-2xl border border-dashed border-line p-4 text-xs text-muted">
            <p className="mb-1 font-medium text-fg/80">Pas assez de données pour établir une recommandation fiable :</p>
            <ul className="list-disc space-y-0.5 pl-4">{bi.missing.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
        )}
      </Section>

      <Section id="segments" n={8} title="Analyse détaillée">
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Axe" className="flex flex-wrap gap-1">
            {DIMS.map((d) => (
              <Link key={d.key} prefetch={false} scroll={false} href={segHref({ axe: d.key })} role="tab" aria-selected={axe === d.key}
                className={`inline-flex min-h-10 items-center rounded-lg px-3 text-sm transition ${axe === d.key ? "bg-accent/15 font-medium text-accent" : "text-muted hover:text-fg"}`}>{d.label}</Link>
            ))}
          </div>
          <div className="ml-auto flex gap-1 rounded-xl border border-line bg-panel/70 p-1 text-sm" aria-label="Période des ventes">
            {PERIODS.map((p) => (
              <Link key={p.key} prefetch={false} scroll={false} href={segHref({ periode: p.key })} aria-current={periode === p.key}
                className={`inline-flex min-h-9 items-center rounded-lg px-3 ${periode === p.key ? "bg-accent/15 text-accent" : "text-muted hover:text-fg"}`}>{p.label}</Link>
            ))}
          </div>
        </div>
        {sorted.length ? (
          <div className="overflow-x-auto rounded-2xl border border-line bg-panel/80">
            <table className="data min-w-[860px]" data-testid="segments">
              <thead>
                <tr>
                  <th>{DIMS.find((d) => d.key === axe)!.label.replace(/s$/, "")}</th>
                  <th className="num">Articles</th><th className="num">Vendus</th><th className="num">Taux de vente</th>
                  <th className="num">Coût moy.</th><th className="num">Prix moy.</th>
                  {SORTS.slice(1, 3).map((t) => <th key={t.key} className="num"><SortLink t={t} tri={tri} href={segHref({ tri: t.key })} /></th>)}
                  <th className="num"><SortLink t={SORTS[3]} tri={tri} href={segHref({ tri: "roi" })} /></th>
                  <th className="num">Délai</th>
                  <th className="num"><SortLink t={SORTS[0]} tri={tri} href={segHref({ tri: "capital" })} /></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.name}>
                    <td className="max-w-[14rem] truncate font-medium">{r.name}</td>
                    <td className="num">{r.items}</td>
                    <td className="num">{r.sold}</td>
                    <td className="num">{r.items ? `${Math.round((r.sold * 100) / r.items)} %` : "—"}</td>
                    <td className="num">{r.avg_cost_cents == null ? "—" : euro(r.avg_cost_cents)}</td>
                    <td className="num">{r.avg_price_cents == null ? "—" : euro(r.avg_price_cents)}</td>
                    <td className="num">{euro(r.revenue_cents)}</td>
                    <td className={`num ${r.margin_cents < 0 ? "text-red-300" : ""}`}>{euro(r.margin_cents)}</td>
                    <td className="num">{r.sold_cost_cents > 0 ? pct((r.margin_cents * 100) / r.sold_cost_cents, 0) : "—"}</td>
                    <td className="num">{r.timed ? `${Math.round(r.avg_days ?? 0)} j` : "—"}</td>
                    <td className="num">{euro(r.stock_cost_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted">Pas encore de données sur cette période.</p>}
        <Explain label="Comment sont calculées ces colonnes ?" lines={[
          { label: "Articles : en stock aujourd'hui + vendus sur la période", value: "" },
          { label: "Taux de vente : vendus ÷ articles", value: "" },
          { label: "CA et marge : ventes de la période, remboursements, frais et port déduits", value: "" },
          { label: "ROI : marge ÷ coût d'achat des articles vendus", value: "" },
          { label: "Délai : moyenne réception → vente (ventes importées sans réception exclues)", value: "" },
          { label: "Capital immobilisé : coût d'achat du stock actuel", value: "" },
        ]} note={`Comparaisons et recommandations seulement à partir de ${MIN_SEGMENT_SALES} ventes par segment.`} />
      </Section>
    </div>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="eyebrow-tight text-muted">{k}</div>
      <div className="font-mono text-lg font-semibold tabular-nums">{v}</div>
    </div>
  );
}

function SortLink({ t, tri, href }: { t: { key: string; label: string }; tri: string; href: string }) {
  return (
    <Link prefetch={false} scroll={false} href={href}
      className={`inline-flex items-center gap-0.5 hover:text-fg ${tri === t.key ? "text-accent" : ""}`}>{t.label}{tri === t.key && " ↓"}</Link>
  );
}
