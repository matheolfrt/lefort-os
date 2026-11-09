import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, Help, PageHeader, Stat, btn, chip, seg } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/session";
import { date } from "@/lib/format";
import { BLAZER_FAMILIES, type Family } from "@/lib/kpi/classify";
import {
  aging, buyers, byDesigner, byFamily, cashCycle, dataQuality, enrich, pace, perHour, sizes, suppliers, unbrandedByFamily,
  type Enriched, type SizeRow,
} from "@/lib/kpi/compute";
import { loadKpi } from "@/lib/kpi/load";
import { GroupTable, eur } from "./group-table";
import { LotCheck, type LotRef } from "./lot-check";

export const metadata = { title: "Indicateurs" };

const MINUTES = [10, 15, 20, 30, 45, 60] as const;
const SIZE_SETS = {
  blazers: { label: "Blazers", keep: (i: Enriched) => BLAZER_FAMILIES.includes(i.family) },
  manteaux: { label: "Manteaux", keep: (i: Enriched) => i.family === "manteau" },
  costumes: { label: "Costumes", keep: (i: Enriched) => i.family === "costume" },
  tout: { label: "Tout", keep: () => true },
} as const;
type SizeSet = keyof typeof SIZE_SETS;
const SECTIONS = [
  ["types", "Par type"], ["marques", "Par marque"], ["lot", "Juger un lot"], ["anciennete", "Stock à baisser"], ["rythme", "Rythme"],
  ["fournisseurs", "Fournisseurs"], ["tailles", "Tailles"], ["acheteurs", "Acheteurs"], ["donnees", "Données à compléter"],
] as const;

const one = (n: number | null, unit = "") => (n == null ? "—" : `${(Math.round(n * 10) / 10).toLocaleString("fr-FR")}${unit}`);
const pctOf = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)} %`);
const int = (n: number) => n.toLocaleString("fr-FR");
const plural = (n: number, w: string) => `${int(n)} ${w}${n > 1 ? "s" : ""}`;
const shortDay = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function Indicateurs({ searchParams }: { searchParams: Promise<{ p?: string; m?: string; t?: string }> }) {
  await requireManager();
  const sp = await searchParams;
  const all = sp.p === "tout";
  const minutes = (MINUTES as readonly number[]).includes(Number(sp.m)) ? Number(sp.m) : 20;
  const sizeSet: SizeSet = sp.t && sp.t in SIZE_SETS ? (sp.t as SizeSet) : "blazers";
  const href = (patch: Record<string, string | undefined>, anchor: string) => {
    const q = new URLSearchParams(Object.entries({ p: all ? "tout" : undefined, m: minutes === 20 ? undefined : String(minutes), t: sizeSet === "blazers" ? undefined : sizeSet, ...patch })
      .filter((e): e is [string, string] => e[1] != null));
    return `/indicateurs${q.size ? `?${q}` : ""}#${anchor}`;
  };

  const supabase = await createClient();
  let data;
  try {
    data = await loadKpi(supabase);
  } catch (e) {
    return (
      <div>
        <PageHeader title="Indicateurs" />
        <Card>Données indisponibles : {(e as Error).message}</Card>
      </div>
    );
  }
  const now = Date.now();
  const items = enrich(data.items);
  const opts = { now, periodDays: all ? null : 365 };
  const families = byFamily(items, opts);
  const brands = byDesigner(items, opts);
  const plain = unbrandedByFamily(items, opts).filter((g) => BLAZER_FAMILIES.includes(g.key as Family) || g.key === "manteau" || g.key === "costume");
  const age = aging(items, now);
  const p = pace(items, now);
  const cycle = cashCycle(items, now);
  const sup = suppliers(items);
  const sz = sizes(items, now, SIZE_SETS[sizeSet].keep);
  const buy = buyers(data.orders, now);
  const dq = dataQuality(items, data.expenses, data.lots, now);
  const hourMargin = p.hour.sold ? p.hour.margin / p.hour.sold : null;
  const refs: LotRef[] = [
    ...families.filter((g) => g.avgPrice != null).map((g) => ({ key: `f:${g.key}`, label: g.label, group: "Types", avgPrice: g.avgPrice!, sold: g.sold })),
    ...brands.filter((g) => g.avgPrice != null).map((g) => ({ key: `b:${g.key}`, label: g.label, group: "Marques", avgPrice: g.avgPrice!, sold: g.sold })),
    ...plain.filter((g) => g.avgPrice != null).map((g) => ({ key: `u:${g.key}`, label: g.label, group: "Sans marque", avgPrice: g.avgPrice!, sold: g.sold })),
  ];
  const period = all ? "tout l'historique" : "les 12 derniers mois";
  const weekMax = Math.max(1, ...p.weeks.map((w) => Math.max(w.listed, w.sold)));

  return (
    <div className="space-y-5">
      <PageHeader title="Indicateurs"
        subtitle="Que racheter et à quel prix, ce qui dort, ton rythme, tes tailles et tes acheteurs. Calculé sur toutes tes ventes."
        actions={
          <nav aria-label="Période" className={seg.wrap}>
            <Link href={href({ p: undefined }, "types")} aria-current={!all ? "true" : undefined} className={seg.item(!all)}>12 mois</Link>
            <Link href={href({ p: "tout" }, "types")} aria-current={all ? "true" : undefined} className={seg.item(all)}>Tout l&apos;historique</Link>
          </nav>
        } />

      <nav aria-label="Sections" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className={`${btn.ghost} shrink-0`}>{label}</a>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Mises en ligne (7 jours)" value={p.listed7}
          hint={`${one(p.listedPerDay30)} par jour sur 30 j · ${one(p.soldPerDay30)} ventes par jour`}
          help="Pièces passées en ligne ces 7 derniers jours. Ton chiffre d'affaires dépend surtout de ce rythme : si tu mets en ligne moins que tu ne vends, ton stock en ligne fond." />
        <Stat label="Stock en mois de ventes" value={p.cover.months == null ? "—" : `${one(p.cover.months)} mois`}
          hint={`${p.cover.stock} pièces en stock · ${Math.round(p.cover.perMonth)} vendues par mois`}
          help="Combien de mois de ventes ton stock tient au rythme des 90 derniers jours. Moins d'un mois : rachète maintenant. Plus de 3 mois : écoule avant de racheter." />
        <Stat label="Cycle de trésorerie" value={cycle.median == null ? "—" : `${Math.round(cycle.median)} j`}
          hint={cycle.n ? `de l'achat du lot à la vente (médiane de ${plural(cycle.n, "vente")})` : "pas encore de vente d'un lot acheté"}
          help="Jours entre le paiement d'un lot et la vente de ses pièces, sur les lots achetés et les ventes des 12 derniers mois. Plus il est court, plus vite ton argent revient pour racheter." />
        <Stat label="Marge par heure" value={eur(perHour(hourMargin, minutes))}
          hint={`90 derniers jours · ${minutes} min de travail par pièce`}
          help="Marge des ventes des 90 derniers jours, divisée par le temps passé (tri, photo, mesures, annonce, colis). Change le temps par pièce dans « Par type »." />
      </div>

      <section id="types" aria-labelledby="types-h" className="scroll-mt-20">
        <Card title={<span id="types-h">Par type · {period}</span>}>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>Temps de travail par pièce :</span>
            <div className={seg.wrap} role="group" aria-label="Minutes de travail par pièce">
              {MINUTES.map((m) => (
                <Link key={m} href={href({ m: m === 20 ? undefined : String(m) }, "types")} aria-current={m === minutes ? "true" : undefined} className={seg.item(m === minutes)}>{m} min</Link>
              ))}
            </div>
          </div>
          <GroupTable rows={families} minutes={minutes} empty="Aucune vente sur la période." />
        </Card>
      </section>

      <section id="marques" aria-labelledby="marques-h" className="scroll-mt-20 space-y-4">
        <Card title={<span id="marques-h">Par marque · {period}</span>}>
          <p className="mb-3 text-sm text-muted">Les marques reconnues dans les titres (Burberry, Polo Ralph Lauren, Dior, Loro Piana…). Une marque absente n&apos;a jamais été vendue.</p>
          <GroupTable rows={brands} minutes={minutes} first="Marque" empty="Aucune marque reconnue dans les titres vendus sur la période." />
        </Card>
        <Card title="Sans marque reconnue, par type">
          <GroupTable rows={plain} minutes={minutes} empty="Aucune vente sans marque sur la période." />
        </Card>
      </section>

      <section id="lot" aria-labelledby="lot-h" className="scroll-mt-20">
        <Card title={<span id="lot-h">Juger un lot avant de l&apos;acheter</span>}>
          <LotCheck refs={refs} />
        </Card>
      </section>

      <section id="anciennete" aria-labelledby="age-h" className="scroll-mt-20">
        <h2 id="age-h" className="eyebrow mb-2 text-highlight">Stock en ligne par ancienneté</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {age.online.map((b) => (
            <div key={b.key} className="glass flex flex-col rounded-2xl p-4">
              <div className="eyebrow-tight text-muted">{b.label}</div>
              <div className="figure mt-1 text-[28px] font-semibold leading-tight tabular-nums">{b.count}</div>
              <div className="text-xs text-muted">affichées {eur(b.value)} · achetées {eur(b.cost)}</div>
              {b.families.length > 0 && <div className="mt-1 text-xs text-muted">{b.families.map((f) => `${f.n} ${f.label}`).join(" · ")}</div>}
              <p className={`mt-2 flex-1 text-sm ${b.key === "0-30" ? "" : "font-medium"}`}>{b.advice}</p>
              {b.count > 0 && b.key !== "0-30" && (
                <Link href={b.href} className={`${btn.ghost} mt-3 self-start`}>Prix à baisser <ArrowRight size={14} /></Link>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted">
          {age.waiting.count
            ? <>{plural(age.waiting.count, "pièce")} en stock pas encore en ligne{age.waiting.old ? <>, dont <strong className="text-fg">{age.waiting.old}</strong> reçue{age.waiting.old > 1 ? "s" : ""} il y a plus de 14 jours</> : ""}. <Link href="/postes/production" className="underline underline-offset-2 hover:text-fg">Voir la production</Link></>
            : "Tout le stock reçu est en ligne."}
        </p>
        {age.undated > 0 && <p className="text-sm text-muted">{plural(age.undated, "annonce")} sans date de mise en ligne : leur âge est compté depuis la réception.</p>}
      </section>

      <section id="rythme" aria-labelledby="rythme-h" className="scroll-mt-20">
        <Card title={<span id="rythme-h">Rythme : mises en ligne et ventes par semaine</span>}>
          <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--series-1)" }} />Mises en ligne</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--series-2)" }} />Ventes</span>
            <span>Chiffres sous les barres : mises en ligne · ventes</span>
          </div>
          <div className="-mx-1 overflow-x-auto px-1">
            <ol className="grid min-w-[36rem] grid-cols-12 items-end gap-2" aria-label="12 dernières semaines">
              {p.weeks.map((w) => (
                <li key={w.start} className="flex flex-col items-center gap-1" aria-label={`Semaine du ${shortDay.format(new Date(`${w.start}T12:00:00Z`))} : ${w.listed} mises en ligne, ${w.sold} ventes`}>
                  <div className="flex h-32 items-end gap-0.5" aria-hidden="true">
                    <span className="w-3 rounded-t-sm" style={{ height: `${(w.listed / weekMax) * 100}%`, minHeight: w.listed ? 3 : 0, background: "var(--series-1)" }} />
                    <span className="w-3 rounded-t-sm" style={{ height: `${(w.sold / weekMax) * 100}%`, minHeight: w.sold ? 3 : 0, background: "var(--series-2)" }} />
                  </div>
                  <span className="text-[11px] tabular-nums text-muted" aria-hidden="true">{w.listed} · {w.sold}</span>
                  <span className="whitespace-nowrap text-[11px] text-muted" aria-hidden="true">{shortDay.format(new Date(`${w.start}T12:00:00Z`))}</span>
                </li>
              ))}
            </ol>
          </div>
          <p className="mt-3 text-sm">
            {p.listedPerDay30 >= p.soldPerDay30
              ? <>Tu mets en ligne <strong>{one(p.listedPerDay30)}</strong> pièces par jour et tu en vends <strong>{one(p.soldPerDay30)}</strong> : ton stock en ligne grossit.</>
              : <>Tu vends <strong>{one(p.soldPerDay30)}</strong> pièces par jour mais n&apos;en mets en ligne que <strong>{one(p.listedPerDay30)}</strong> : ton stock en ligne fond, mets-en plus en ligne.</>}
            {p.cover.onlineMonths != null && <span className="text-muted"> En ligne : {p.cover.online} pièces, soit {one(p.cover.onlineMonths)} mois de ventes.</span>}
          </p>
        </Card>
      </section>

      <section id="fournisseurs" aria-labelledby="sup-h" className="scroll-mt-20">
        <Card title={<span id="sup-h">Fournisseurs · lots achetés, tout l&apos;historique</span>}>
          {sup.length === 0 ? <p className="text-sm text-muted">Aucun lot acheté enregistré pour l&apos;instant (le dressing importé n&apos;est pas un lot d&apos;achat).</p> : (
            <div className="-mx-4 -mb-4 overflow-x-auto sm:-mx-5 sm:-mb-5">
              <table className="data">
                <thead><tr>
                  <th>Fournisseur</th><th className="num">Lots</th><th className="num">Pièces</th><th className="num">% vendus</th>
                  <th className="num"><span className="inline-flex items-center gap-1">Coût / pièce<Help text="Prix d'achat moyen par pièce, transport, douane et frais du lot compris (les pièces sans prix réel ne comptent pas)." /></span></th>
                  <th className="num">Marge / pièce</th>
                  <th className="num"><span className="inline-flex items-center gap-1">Cycle<Help text="Jours médians entre l'achat du lot et la vente d'une pièce." /></span></th>
                </tr></thead>
                <tbody>
                  {sup.map((s) => (
                    <tr key={s.name}>
                      <td className="font-medium">{s.name}</td><td className="num">{s.lots}</td><td className="num">{s.pieces}</td>
                      <td className="num">{s.pct == null ? "—" : `${Math.round(s.pct)} %`}</td>
                      <td className="num">{eur(s.costPerPiece)}</td><td className="num">{eur(s.marginPerPiece)}</td>
                      <td className="num">{s.cycle == null ? "—" : `${Math.round(s.cycle)} j`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link href="/fournisseurs" className={`${btn.ghost} mt-6`}>Verdicts et détail des fournisseurs <ArrowRight size={14} /></Link>
        </Card>
      </section>

      <section id="tailles" aria-labelledby="tailles-h" className="scroll-mt-20">
        <Card title={<span id="tailles-h">Tailles vendues et en stock · 12 derniers mois</span>}>
          <div className={`${seg.wrap} mb-3`} role="group" aria-label="Pièces">
            {(Object.keys(SIZE_SETS) as SizeSet[]).map((k) => (
              <Link key={k} href={href({ t: k === "blazers" ? undefined : k }, "tailles")} aria-current={k === sizeSet ? "true" : undefined} className={seg.item(k === sizeSet)}>{SIZE_SETS[k].label}</Link>
            ))}
          </div>
          <SizeTable rows={sz} />
        </Card>
      </section>

      <section id="acheteurs" aria-labelledby="ach-h" className="scroll-mt-20 space-y-2">
        <h2 id="ach-h" className="eyebrow text-highlight">Acheteurs · 12 derniers mois</h2>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="Acheteurs" value={buy.buyers} hint={`${buy.orders} commandes`} />
          <Stat label="Reviennent" value={buy.repeat} hint={buy.buyers ? `${pctOf(buy.repeat / buy.buyers)} des acheteurs` : "—"}
            help="Acheteurs qui ont commandé au moins deux fois sur 12 mois." />
          <Stat label="CA des fidèles" value={pctOf(buy.repeatRevenueShare)} hint="part du chiffre d'affaires" />
          <Stat label="Panier moyen" value={eur(buy.avgBasket)} hint={`${one(buy.itemsPerOrder)} pièce par commande · ${pctOf(buy.multiShare)} à plusieurs pièces`} />
        </div>
        {buy.top.length > 0 && (
          <Card title="Meilleurs acheteurs">
            <div className="-mx-4 -mb-4 overflow-x-auto sm:-mx-5 sm:-mb-5">
              <table className="data">
                <thead><tr><th>Acheteur</th><th className="num">Commandes</th><th className="num">Pièces</th><th className="num">Dépensé</th><th>Dernier achat</th></tr></thead>
                <tbody>
                  {buy.top.map((b) => (
                    <tr key={b.handle}><td className="font-medium">{b.handle}</td><td className="num">{b.orders}</td><td className="num">{b.items}</td><td className="num">{eur(b.spent)}</td><td>{date(b.last)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-6 text-sm text-muted">Tes fidèles achètent ton style : préviens-les quand tu mets en ligne des pièces dans leur taille, et propose une remise dès 2 pièces pour augmenter le panier.</p>
          </Card>
        )}
      </section>

      <section id="donnees" aria-labelledby="dq-h" className="scroll-mt-20">
        <Card title={<span id="dq-h">Données à compléter</span>}>
          <p className="mb-3 text-sm text-muted">Sans elles, plusieurs indicateurs restent approximatifs.</p>
          <ul className="divide-y divide-line">
            <Todo ok={dq.soldNoCost === 0 && dq.stockNoCost === 0}
              title={`Prix d'achat réels : ${int(dq.soldNoCost)} vente${dq.soldNoCost > 1 ? "s" : ""} sur ${int(dq.soldTotal)} (12 mois) et ${plural(dq.stockNoCost, "pièce")} en stock sans prix d'achat`}
              detail="Les marges comptent pour l'instant 10 € par Harris, manteau ou costume et 4 € par autre pièce. Dans le Stock, cherche par exemple « harris », sélectionne tout et saisis le prix d'achat en une fois."
              action={dq.soldNoCost + dq.stockNoCost > 0 ? { href: "/stock?cout=inconnu", label: "Voir les pièces sans prix d'achat" } : undefined} />
            <Todo ok={dq.expenses90.n > 0}
              title={dq.expenses90.n ? `Dépenses : ${plural(dq.expenses90.n, "dépense")} enregistrée${dq.expenses90.n > 1 ? "s" : ""} en 90 jours (${eur(dq.expenses90.cents)})` : "Dépenses : aucune enregistrée ces 90 derniers jours"}
              detail="Emballages, frais Fleek, essence, matériel : sans elles, ton bénéfice réel est surestimé."
              action={{ href: "/finance/parametres", label: "Ajouter une dépense" }} />
            <Todo ok={dq.lotsNoFees.length === 0}
              title={dq.lotsNoFees.length ? `Frais des lots : ${plural(dq.lotsNoFees.length, "lot")} acheté${dq.lotsNoFees.length > 1 ? "s" : ""} sans transport, douane ni frais` : "Frais des lots : renseignés"}
              detail={dq.lotsNoFees.length ? <>Ajoute le transport et la douane au coût du lot : {dq.lotsNoFees.slice(0, 8).map((l, n) => (
                <span key={l.id}>{n ? ", " : ""}<Link href={`/lots/${l.id}`} className="font-mono underline underline-offset-2 hover:text-fg">{l.code}</Link></span>
              ))}{dq.lotsNoFees.length > 8 ? "…" : ""}.</> : "Le coût de chaque lot acheté comprend ses frais."} />
            <Todo ok={dq.onlineNoDate === 0}
              title={dq.onlineNoDate ? `Dates de mise en ligne : ${plural(dq.onlineNoDate, "annonce")} en ligne sur ${int(dq.online)} sans date` : "Dates de mise en ligne : connues"}
              detail="Les pièces importées du dressing Vinted n'ont pas de date. Les nouvelles l'enregistrent toutes seules quand tu les passes en ligne : les délais de vente deviendront exacts au fil des lots." />
          </ul>
        </Card>
      </section>
    </div>
  );
}

const SIZE_VERDICT: Record<SizeRow["verdict"], { label: string; tone: string }> = {
  manque: { label: "À racheter", tone: "bg-accent/15 text-accent ring-accent/30" },
  trop: { label: "Trop de stock", tone: "bg-amber-400/10 text-amber-300 ring-amber-400/25" },
  ok: { label: "Équilibré", tone: "bg-fg/5 text-muted ring-line" },
  few: { label: "Peu de données", tone: "bg-fg/5 text-muted ring-line" },
};

function SizeTable({ rows }: { rows: SizeRow[] }) {
  if (!rows.some((r) => r.sold || r.stock)) return <p className="text-sm text-muted">Aucune pièce de ce type vendue ou en stock.</p>;
  return (
    <div className="-mx-4 -mb-4 overflow-x-auto sm:-mx-5 sm:-mb-5">
      <table className="data">
        <thead><tr>
          <th>Taille</th><th className="num">Vendues</th><th className="num">En stock</th>
          <th className="num"><span className="inline-flex items-center gap-1">Couverture<Help text="Mois de ventes que le stock de cette taille tient, au rythme des 12 derniers mois." /></span></th>
          <th className="num">Délai</th><th className="num">Prix moyen</th><th>Verdict</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.size ?? "?"}>
              <td className="font-medium">{r.size ?? <span className="text-muted">Non reconnue</span>}</td>
              <td className="num">{r.sold}{r.soldShare != null && <span className="block text-xs text-muted">{pctOf(r.soldShare)}</span>}</td>
              <td className="num">{r.stock}{r.stockShare != null && <span className="block text-xs text-muted">{pctOf(r.stockShare)}</span>}</td>
              <td className="num">{r.cover == null ? "—" : `${one(r.cover)} mois`}</td>
              <td className="num">{r.medianDays == null ? "—" : `${Math.round(r.medianDays)} j`}</td>
              <td className="num">{eur(r.avgPrice)}</td>
              <td>{r.size && <span className={`${chip} ${SIZE_VERDICT[r.verdict].tone}`}>{SIZE_VERDICT[r.verdict].label}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Todo({ ok, title, detail, action }: { ok: boolean; title: string; detail: React.ReactNode; action?: { href: string; label: string } }) {
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-start gap-2 font-medium">
          <span aria-hidden="true" className={`mt-1.5 size-2.5 shrink-0 rounded-full ${ok ? "bg-accent" : "bg-amber-400"}`} />
          <span><span className="sr-only">{ok ? "Fait : " : "À faire : "}</span>{title}</span>
        </div>
        <p className="ml-[1.125rem] mt-0.5 text-sm text-muted">{detail}</p>
      </div>
      {action && !ok && <Link href={action.href} className={`${btn.ghost} shrink-0 self-start sm:self-center`}>{action.label}</Link>}
    </li>
  );
}
