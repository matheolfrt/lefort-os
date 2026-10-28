import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import {
  AlertTriangle, Camera, ChevronRight, PackageCheck, PackageOpen, Ruler, Send, Tag, Warehouse, type LucideIcon,
} from "lucide-react";
import { getContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { LOW_SAMPLE, loadDashboard, type PeriodResult } from "@/lib/dashboard";
import { buildAdvice, eur as eur0, type Advice, type Facts } from "@/lib/advisor";
import { sellThroughAdvice, type SellThroughStats } from "@/lib/sellthrough";
import { PIPELINE, STATUS_LABEL, STATUS_DOT } from "@/i18n/fr";
import { money } from "@/lib/format";
import { MICRO_TURNOVER_CEILING_CENTS, VAT_FRANCHISE_THRESHOLD_CENTS } from "@/lib/compliance";
import { StartWork } from "@/components/dashboard/start-work";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { SalesTrend } from "@/components/dashboard/sales-trend";
import { Help } from "@/components/ui";
import { GoalsCard, GoalsSkeleton } from "@/components/goals/goals-card";
import { TodosCard } from "@/components/todos/todos-card";
import { PriceReminder } from "@/components/dashboard/price-reminder";
import { FinanceCard } from "@/components/dashboard/finance-card";
import type { ItemStatus } from "@/lib/types";

const euro0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur = (cents: number | null | undefined) => (cents == null ? "—" : euro0.format(Math.round(cents / 100)));

export default async function Dashboard() {
  const ctx = await getContext();
  const supabase = await createClient();
  const d = await loadDashboard(supabase, ctx.org, ctx.isManager);
  const f = d.finance;
  const q = (s: ItemStatus) => d.pipeline[s] ?? { count: 0, oldestDays: null };
  const toStore = q("measured").count + q("returned").count;

  const todo: TodoProps[] = [
    { label: "À trier", icon: PackageOpen, href: "/stock?status=received", ...q("received"), lateAfter: 3 },
    { label: "À photographier", icon: Camera, href: "/stock?status=sorted", ...q("sorted"), lateAfter: 7 },
    { label: "À mesurer", icon: Ruler, href: "/stock?status=photographed", ...q("photographed"), lateAfter: 7 },
    { label: "À publier", icon: Send, href: "/stock?status=listing_ready", ...q("listing_ready"), lateAfter: 7 },
    { label: "À ranger", icon: Warehouse, href: "/postes/rangement", count: toStore,
      oldestDays: Math.max(q("measured").oldestDays ?? 0, q("returned").oldestDays ?? 0) || null, lateAfter: 3 },
    { label: "À expédier", icon: PackageCheck, href: "/postes/expedition", count: d.shipping.orders, oldestDays: d.shipping.oldestDays,
      lateAfter: 1, unit: "commande" },
  ];
  if (d.toLabel > 0) {
    todo.push({ label: "À étiqueter", icon: Tag, href: "/emplacements/EMP-A-ETIQUETER", count: d.toLabel, oldestDays: null,
      note: "Import Vinted" });
  }

  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });
  const lateShip = d.shipping.orders > 0 && (d.shipping.oldestDays ?? 0) >= 1;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* ── Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow text-highlight">{today}</p>
          <h1 className="mt-1 text-3xl font-bold leading-tight tracking-[-0.04em] sm:text-[40px]">Tableau de bord</h1>
        </div>
        <StartWork counts={{
          receive: q("received").count, photo: q("sorted").count, measure: q("photographed").count,
          publish: q("listing_ready").count, store: toStore, ship: d.shipping.orders,
        }} />
      </header>

      {lateShip && (
        <Link href="/postes/expedition" className="flex min-h-12 items-center gap-3 rounded-2xl bg-red-500/15 px-4 py-3 font-semibold text-red-200 ring-1 ring-inset ring-red-400/40 transition hover:bg-red-500/20">
          <AlertTriangle size={20} className="shrink-0" />
          <span className="flex-1">
            {d.shipping.orders} commande{d.shipping.orders > 1 ? "s" : ""} à expédier, la plus ancienne vendue il y a {d.shipping.oldestDays} j
          </span>
          <ChevronRight size={20} />
        </Link>
      )}

      {/* ── What to do now */}
      <Section title="À faire maintenant">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 xl:grid-flow-col xl:auto-cols-fr xl:grid-cols-none">
          {todo.map((t) => <TodoTile key={t.label} {...t} />)}
        </div>
      </Section>

      {/* ── Objectives: today and this month. Streamed in below the to-do tiles so that the tiles do not move under a finger */}
      <Suspense fallback={<GoalsSkeleton />}>
        <GoalsCard isManager={ctx.isManager} />
      </Suspense>

      {ctx.isManager && <Suspense fallback={null}><PriceReminder /></Suspense>}

      {ctx.isManager && <Suspense fallback={<div className="skeleton h-28 rounded-2xl" />}><FinanceCard /></Suspense>}

      {/* ── The day's to-dos */}
      <Suspense fallback={<div className="skeleton h-28 rounded-2xl" />}>
        <TodosCard me={ctx.userId} isManager={ctx.isManager} />
      </Suspense>

      {/* ── Advice: the heaviest figures, streamed in after the rest of the page */}
      {ctx.isManager && (
        <Suspense fallback={<AdviceSkeleton />}>
          <AdviceCard quarterly={ctx.org.declaration_frequency === "quarterly"} />
        </Suspense>
      )}

      {/* ── KPI */}
      <Section title={f ? "Ce mois-ci" : "Stock"}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {f && (
            <>
              <Kpi label="CA encaissé" value={eur(f.monthCashedCents)} hint={`${eur(f.yearCashedCents)} depuis janvier`}
                help="Argent réellement reçu ce mois (ventes encaissées, remboursements déduits). C'est ce chiffre qui compte pour l'URSSAF et les seuils." />
              <Kpi label="Bénéfice estimé" value={eur(f.month.afterCents)} tone={f.month.afterCents < 0 ? "bad" : undefined}
                hint="après coûts et cotisations" n={f.month.itemsSold}
                help="Ventes du mois moins le coût d'achat des articles vendus, les frais (Vinted, envoi) et les cotisations URSSAF estimées." />
              <Kpi label="Ventes" value={String(f.month.itemsSold)} hint={`${eur(f.month.revenueCents)} de ventes`} />
            </>
          )}
          <Kpi label="Stock" value={String(d.stock.count)} hint={`dont ${d.stock.listedCount} en ligne`} />
          {f && <Kpi label="Valeur d'achat du stock" value={eur(f.stockCostCents)} hint="coût de revient"
            help="Ce que vous avez payé pour les articles encore en stock (part du lot + frais). C'est l'argent immobilisé à faire tourner." />}
          <Kpi label="Valeur de vente potentielle" value={eur(d.stock.potentialCents)}
            hint={`${d.stock.pricedCount} article${d.stock.pricedCount > 1 ? "s" : ""} avec un prix`}
            help="Somme des prix affichés des articles en stock. Les articles sans prix ne sont pas comptés." />
          {f && (
            <>
              <Kpi label="Panier moyen" value={eur(f.avgBasket.cents)} hint="par commande ce mois" n={f.avgBasket.n}
                help="Montant moyen d'une commande (un lot de plusieurs articles compte pour une commande)." />
              <Kpi label="Délai moyen de vente" value={f.avgDaysToSell.days == null ? "—" : `${Math.round(f.avgDaysToSell.days)} j`}
                hint="mise en ligne → vente, 90 j" n={f.avgDaysToSell.n}
                help="Nombre moyen de jours entre la mise en ligne et la vente, sur les ventes des 90 derniers jours. Plus c'est court, plus votre argent tourne vite." />
            </>
          )}
        </div>
      </Section>

      {/* ── This month / this week, day by day */}
      {f && <SalesTrend trend={f.trend} />}

      {/* ── Production line */}
      <Section
        title="Chaîne de production"
        aside={(q("on_hold").count > 0 || q("returned").count > 0) && (
          <span className="flex gap-3 text-sm">
            {q("on_hold").count > 0 && <Link className="inline-flex min-h-11 items-center font-semibold text-amber-700 underline-offset-2 hover:underline dark:text-amber-400" href="/stock?status=on_hold">{q("on_hold").count} en attente</Link>}
            {q("returned").count > 0 && <Link className="inline-flex min-h-11 items-center font-semibold text-rose-700 underline-offset-2 hover:underline" href="/stock?status=returned">{q("returned").count} retour{q("returned").count > 1 ? "s" : ""}</Link>}
          </span>
        )}
      >
        <Pipeline counts={PIPELINE.map((s) => ({ status: s, ...q(s) }))} />
      </Section>

      {/* ── Money & stock health */}
      <div className={`grid gap-5 ${f ? "lg:grid-cols-[1.6fr_1fr]" : ""}`}>
        {f && (
          <Section title="Finance">
            <div className="rounded-2xl border border-line bg-panel/80 p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="eyebrow text-muted">CA encaissé · 12 derniers mois</span>
                <Link href="/statistiques" className="-my-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-series-1 hover:underline">
                  Statistiques <ChevronRight size={16} />
                </Link>
              </div>
              <RevenueChart months={f.months} />
              <FinanceTable month={f.month} year={f.year} ratePct={f.contributionRatePct} />
            </div>
          </Section>
        )}
        <div className="space-y-5">
          <Section title="Âge du stock">
            <StockAge buckets={d.ageBuckets} total={d.stock.count} />
          </Section>
          {f && (
            <Section title="Seuils micro-entreprise">
              <div className="space-y-3 rounded-2xl border border-line bg-panel/80 p-4">
                <Gauge label="Franchise de TVA" value={f.yearCashedCents} max={VAT_FRANCHISE_THRESHOLD_CENTS} />
                <Gauge label="Plafond micro" value={f.yearCashedCents} max={MICRO_TURNOVER_CEILING_CENTS} />
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="eyebrow text-muted">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

interface TodoProps {
  label: string; icon: LucideIcon; href: string; count: number; oldestDays: number | null;
  lateAfter?: number; unit?: string; note?: string;
}

function TodoTile({ label, icon: Icon, href, count, oldestDays, lateAfter, note }: TodoProps) {
  const late = count > 0 && lateAfter != null && (oldestDays ?? 0) >= lateAfter;
  return (
    <Link
      href={href}
      className={`group flex min-h-[92px] flex-col justify-between rounded-xl border bg-panel p-3 transition hover:border-fg/30 active:scale-[0.98] ${
        late ? "border-red-400 dark:border-red-500/60" : "border-line"
      }`}
    >
      <div className="flex items-center justify-between text-muted">
        <Icon size={18} className={count ? "text-fg/70" : ""} />
        <ChevronRight size={16} className="opacity-0 transition group-hover:opacity-100" />
      </div>
      <div>
        <div className={`text-[28px] font-mono font-semibold leading-none tabular-nums ${count ? "" : "text-muted/40"}`}>{count}</div>
        <div className="mt-1 text-sm font-semibold leading-tight">{label}</div>
        <div className={`text-xs ${late ? "font-semibold text-red-600 dark:text-red-400" : "text-muted"}`}>
          {note ?? (count && oldestDays != null ? (late ? `en retard · ${oldestDays} j` : `plus ancien ${oldestDays} j`) : count ? "\u00a0" : "Rien en attente")}
        </div>
      </div>
    </Link>
  );
}

function SampleSize({ n }: { n: number }) {
  if (n >= LOW_SAMPLE) return null;
  return (
    <span title="Échantillon faible : à interpréter avec prudence" className="rounded bg-line/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold normal-case tracking-normal text-muted">
      n={n}
    </span>
  );
}

function Kpi({ label, value, hint, n, tone, help }: { label: string; value: string; hint?: string; n?: number; tone?: "bad"; help?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/80 px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow-tight flex items-start gap-1 text-muted">{label}{help && <Help text={help} />}</span>
        {n != null && <SampleSize n={n} />}
      </div>
      <div className={`mt-1 text-[26px] font-mono font-semibold leading-tight tabular-nums tracking-tight ${tone === "bad" ? "text-red-600 dark:text-red-400" : ""}`}>
        {value}
      </div>
      {hint && <div className="text-xs leading-snug text-muted">{hint}</div>}
    </div>
  );
}

// Dots reuse the status colours of the chips used everywhere else in the app
const dot = (s: ItemStatus) => STATUS_DOT[s];

function Pipeline({ counts }: { counts: { status: ItemStatus; count: number; oldestDays: number | null }[] }) {
  // bottleneck: the busiest step before publication
  const before = counts.filter((c) => ["received", "sorted", "photographed", "measured", "listing_ready"].includes(c.status));
  const top = before.reduce((a, b) => (b.count > a.count ? b : a), before[0]);
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
      <ol className="flex min-w-max gap-1 md:grid md:min-w-0 md:grid-cols-9">
        {counts.map((c, i) => {
          const bottleneck = c.status === top.status && c.count > 0;
          return (
            <li key={c.status} className="flex items-center gap-1">
              <Link
                href={`/stock?status=${c.status}`}
                className={`flex min-h-[76px] w-[104px] flex-col justify-between rounded-lg border bg-panel px-2.5 py-2 transition hover:border-fg/30 active:scale-[0.98] md:w-full ${
                  bottleneck ? "border-amber-400 dark:border-amber-500/60" : "border-line"
                }`}
              >
                <span className="eyebrow-tight flex items-center gap-1.5 text-[10px] leading-tight text-muted">
                  <span className={`size-2 shrink-0 rounded-full ${dot(c.status)}`} />
                  {STATUS_LABEL[c.status]}
                </span>
                <span className={`text-2xl font-mono font-semibold leading-none tabular-nums ${c.count ? "" : "text-muted/40"}`}>{c.count}</span>
                <span className="text-[10px] text-muted">{bottleneck ? "goulot" : " "}</span>
              </Link>
              {i < counts.length - 1 && <ChevronRight size={14} className="shrink-0 text-muted/50 md:hidden" />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function FinanceTable({ month, year, ratePct }: { month: PeriodResult; year: PeriodResult; ratePct: number }) {
  const rows: { label: string; key: keyof PeriodResult; strong?: boolean; minus?: boolean }[] = [
    { label: "CA des ventes", key: "revenueCents" },
    { label: "Coûts (achat, frais, port)", key: "costsCents", minus: true },
    { label: "Bénéfice avant cotisations", key: "beforeCents", strong: true },
    { label: `Cotisations estimées (${String(ratePct).replace(".", ",")} %)`, key: "contributionsCents", minus: true },
    { label: "Bénéfice après cotisations", key: "afterCents", strong: true },
  ];
  return (
    <table className="mt-4 w-full text-[13px] sm:text-sm">
      <thead>
        <tr className="text-[11px] uppercase tracking-wide text-muted">
          <th className="pb-1 text-left font-semibold" />
          <th className="pb-1 text-right font-semibold">Mois <SampleSize n={month.itemsSold} /></th>
          <th className="pb-1 text-right font-semibold">Année <SampleSize n={year.itemsSold} /></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className={r.strong ? "border-t border-line font-bold" : "text-muted"}>
            <td className="py-1.5 pr-2">{r.label}</td>
            {[month, year].map((p, i) => {
              const v = p[r.key];
              return (
                <td key={i} className={`py-1.5 text-right tabular-nums ${r.strong && v < 0 ? "text-red-600 dark:text-red-400" : r.strong ? "text-fg" : ""}`}>
                  {r.minus && v ? "−" : ""}{money(v)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const AGE_TONE = {
  ok: "bg-fg/25",
  watch: "bg-fg/45",
  warn: "bg-amber-500",
  alert: "bg-red-600",
} as const;

function StockAge({ buckets, total }: { buckets: { label: string; count: number; tone: keyof typeof AGE_TONE }[]; total: number }) {
  const old = buckets.filter((b) => b.tone === "warn" || b.tone === "alert").reduce((s, b) => s + b.count, 0);
  return (
    <div className="rounded-2xl border border-line bg-panel/80 p-4">
      <div className="mb-3 flex h-3 overflow-hidden rounded-full bg-line">
        {buckets.map((b) => b.count > 0 && (
          <div key={b.label} className={`${AGE_TONE[b.tone]} border-r-2 border-panel last:border-r-0`} style={{ width: `${(b.count / Math.max(total, 1)) * 100}%` }} />
        ))}
      </div>
      <dl className="grid grid-cols-4 gap-2">
        {buckets.map((b) => (
          <div key={b.label}>
            <dt className="flex items-center gap-1.5 text-[11px] font-semibold text-muted">
              <span className={`size-2 rounded-full ${AGE_TONE[b.tone]}`} />{b.label}
            </dt>
            <dd className={`text-xl font-mono font-semibold tabular-nums ${b.tone === "alert" && b.count ? "text-red-600 dark:text-red-400" : b.tone === "warn" && b.count ? "text-amber-600 dark:text-amber-400" : ""}`}>
              {b.count}
            </dd>
          </div>
        ))}
      </dl>
      {old > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {old} article{old > 1 ? "s" : ""} en stock depuis plus de 60 jours : pensez à baisser le prix ou à les republier.
        </p>
      )}
    </div>
  );
}

function Gauge({ label, value, max }: { label: string; value: number; max: number }) {
  const ratio = Math.min(1, value / max);
  const tone = ratio >= 0.95 ? "bg-red-600" : ratio >= 0.8 ? "bg-amber-500" : "bg-emerald-600";
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted">{eur(value)} / {eur(max)} · <b className="text-fg">{Math.round(ratio * 100)} %</b></span>
      </div>
      <div className="h-2 rounded-full bg-line">
        <div className={`h-2 rounded-full ${tone}`} style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 1 : 0)}%` }} />
      </div>
    </div>
  );
}

async function AdviceCard({ quarterly }: { quarterly: boolean }) {
  const supabase = await createClient();
  // a database without the advisor migration simply shows no card
  const [{ data, error }, { data: st }] = await Promise.all([supabase.rpc("advisor_facts"), supabase.rpc("sellthrough_stats")]);
  if (error || !data) return null;
  const advice = buildAdvice(data as Facts, new Date(), quarterly);
  const rotation = st ? sellThroughAdvice(st as SellThroughStats) : [];
  const tasks = [...advice.tasks, ...rotation.filter((a) => a.id.startsWith("st-risk"))].sort((a, b) => b.score - a.score);
  const money = [...advice.advice, ...rotation.filter((a) => !a.id.startsWith("st-risk") && a.tone !== "info")].sort((a, b) => b.score - a.score);
  const top: Advice[] = [...tasks.slice(0, 3), ...money.slice(0, 2)];
  if (!top.length) return null;
  return (
    <Section title="Conseils" aside={
      <Link href="/conseils" className="-my-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-series-1 hover:underline">
        Tous les conseils <ChevronRight size={16} />
      </Link>
    }>
      <ul className="page-in divide-y divide-line rounded-2xl border border-line bg-panel/80" data-testid="dashboard-advice">
        {top.map((a) => (
          <li key={a.id}>
            <Link href={a.href?.startsWith("#") ? `/conseils${a.href}` : a.href ?? "/conseils"} className="flex min-h-12 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-fg/[0.03]">
              <span className={`size-2.5 shrink-0 rounded-full ${a.tone === "urgent" ? "bg-red-500" : a.tone === "high" ? "bg-orange-400" : "bg-accent"}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{a.title}</span>
                <span className="block truncate text-xs text-muted">{a.detail}</span>
              </span>
              {a.impactCents != null && a.impactCents > 0 && <span className="hidden font-mono text-sm sm:block">{eur0(a.impactCents)}</span>}
              <ChevronRight size={18} className="shrink-0 text-muted/60" />
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AdviceSkeleton() {
  return (
    <Section title="Conseils">
      <div className="space-y-px overflow-hidden rounded-2xl border border-line bg-panel/80">
        {[0, 1, 2].map((i) => <div key={i} className="flex items-center gap-3 px-4 py-3"><div className="skeleton size-2.5 rounded-full" /><div className="flex-1 space-y-1.5"><div className="skeleton h-4 w-1/3 rounded" /><div className="skeleton h-3 w-2/3 rounded" /></div></div>)}
      </div>
    </Section>
  );
}
