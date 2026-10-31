import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Pause, Play, Trash2 } from "lucide-react";
import { getContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, Help, PageHeader, btn, seg } from "@/components/ui";
import { collectorStates } from "@/lib/market/status";
import { vintedSearchUrl, type MarketQuery } from "@/lib/market/collect";
import { duration, eurC, filters } from "@/lib/market/format";
import { deleteSearch, setSearchActive } from "../actions";
import { Collectors } from "../collectors";
import { ConfirmDelete } from "./confirm-delete";

interface Overview {
  items: number; active: number; sold: number; gone: number; rate: number | null; avg_hours: number | null; median_hours: number | null;
  avg_sold_price_cents: number | null; avg_price_cents: number | null; revenue_30_cents: number; sold_per_day: number; new_per_day: number;
  observed_days: number; first_run: string | null; score: number | null;
  daily: { day: string; new: number; sold: number; gone: number }[];
  sell_times: { label: string; n: number }[]; prices: { label: string; listed: number; sold: number }[];
  last_run: { at: string; ok: boolean; collector: string; error: string | null; http_status: number | null } | null;
}
interface Group { key: string; items: number; sold: number; gone: number; rate: number; avg_hours: number | null; sold_per_day: number; avg_price_cents: number | null; revenue_cents: number; score: number | null }
interface Item { vinted_id: number; title: string | null; brand: string | null; size: string | null; price_cents: number | null; photo_url: string | null; url: string | null;
  seller_login: string | null; listed_at: string; listed_exact: boolean; ended_at: string | null; alive_at: string | null; state: string; favourites: number | null; first_seen_at: string }

const TABS = [["ventes", "Ventes"], ["niches", "Niches"], ["stats", "Statistiques"], ["vendeurs", "Vendeurs"], ["annonces", "Annonces"]] as const;
type Tab = (typeof TABS)[number][0];
const PERIODS = [7, 30, 90] as const;
const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)} %`);
const n2 = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("fr-FR", { maximumFractionDigits: v < 10 ? 2 : 0 }));
const when = (d: string | null) => (d ? new Date(d).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export default async function MarketSearch({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; jours?: string; error?: string; cree?: string; disparues?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getContext();
  const supabase = await createClient();
  const tab: Tab = (TABS.find(([k]) => k === sp.tab)?.[0] ?? "ventes");
  const days = PERIODS.find((p) => String(p) === sp.jours) ?? 30;
  const { data: s } = await supabase.from("market_searches").select("id, name, domain, query, active, created_at, last_run_at").eq("id", id).maybeSingle();
  if (!s) notFound();
  const [ov, groups, items, collectors] = await Promise.all([
    supabase.rpc("market_overview", { p_search_id: id, p_days: days }),
    tab === "niches" || tab === "vendeurs" ? supabase.rpc("market_groups", { p_search_id: id, p_by: tab === "niches" ? "brand" : "seller", p_days: days }) : Promise.resolve({ data: [], error: null }),
    tab === "ventes" || tab === "annonces"
      ? (tab === "ventes"
        ? supabase.from("market_items").select("*").eq("search_id", id).in("state", sp.disparues ? ["sold", "gone"] : ["sold"]).order("ended_at", { ascending: false }).limit(200)
        : supabase.from("market_items").select("*").eq("search_id", id).order("listed_at", { ascending: false }).limit(200))
      : Promise.resolve({ data: [], error: null }),
    collectorStates(supabase, id),
  ]);
  if (ov.error) throw new Error(ov.error.message);
  const o = ov.data as Overview;
  const q = s.query as MarketQuery;
  const href = (p: Record<string, string | null>) => {
    const u = new URLSearchParams({ tab, jours: String(days), ...(sp.disparues ? { disparues: "1" } : {}) });
    for (const [k, v] of Object.entries(p)) if (v == null) u.delete(k); else u.set(k, v);
    return `/niches-vinted/${id}?${u}`;
  };
  const empty = o.items === 0;

  return (
    <div className="space-y-4">
      <PageHeader back="/niches-vinted" title={s.name}
        subtitle={<>{filters(q)} · {s.domain.replace("www.", "")} · suivie depuis le {new Date(s.created_at).toLocaleDateString("fr-FR")}{!s.active && " · en pause"}</>}
        actions={<>
          <a href={vintedSearchUrl(s.domain, q)} target="_blank" rel="noreferrer" className={btn.secondary}><ExternalLink size={16} /> Voir sur Vinted</a>
          {ctx.isManager && <form action={setSearchActive.bind(null, id, !s.active)}><button className={`${btn.secondary} w-full`}>{s.active ? <><Pause size={16} /> Mettre en pause</> : <><Play size={16} /> Reprendre</>}</button></form>}
          {ctx.isManager && <ConfirmDelete action={deleteSearch.bind(null, id)}><Trash2 size={16} /> Supprimer</ConfirmDelete>}
        </>} />
      {sp.error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">{sp.error}</p>}
      {sp.cree && <p role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">Recherche ajoutée. Les annonces arriveront au prochain passage d&apos;un collecteur ; vous pouvez aussi lancer un passage maintenant, en bas de la page.</p>}

      {/* ── key figures, only from what was collected */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted" data-testid="observed">
          {empty ? "Rien de collecté pour l'instant." : <>Observé sur <b className="text-fg">{n2(o.observed_days)} jour{o.observed_days >= 2 ? "s" : ""}</b> · {o.items.toLocaleString("fr-FR")} annonces · {o.active.toLocaleString("fr-FR")} encore en vente</>}
        </p>
        <div className={seg.wrap} role="radiogroup" aria-label="Période">
          {PERIODS.map((p) => <Link key={p} href={href({ jours: String(p) })} role="radio" aria-checked={p === days} className={seg.item(p === days)}>{p} j</Link>)}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="m-kpis">
        <Tile k="Score de la niche" v={o.score == null ? "—" : `${o.score}/100`} hint={o.score == null ? "il faut 5 annonces et une vente" : o.score >= 70 ? "bonne niche" : o.score >= 45 ? "correcte" : "faible"}
          help="Sur 100 : 50 pour la part vendue (plein à 60 %), 30 pour la vitesse (plein si ça part tout de suite, rien à 14 jours), 20 pour le volume (plein à 2 ventes par jour)." />
        <Tile k="CA vu sur 30 j" v={eurC(o.revenue_30_cents)} hint="prix affichés des annonces vendues" help="Somme des prix affichés des annonces que Vinted a marquées vendues pendant les 30 derniers jours de suivi. Ce n'est pas tout le marché : seulement ce que vos collecteurs ont vu." />
        <Tile k="% de vente" v={pct(o.rate)} hint={`${o.sold} vendues${o.gone ? ` · ${o.gone} disparues` : ""}`} help="Annonces vendues ÷ annonces vues sur la période. Les annonces disparues sans raison (supprimées ou vendues) ne sont pas comptées comme ventes." />
        <Tile k="Temps de vente" v={duration(o.avg_hours)} hint={o.median_hours != null ? `médiane ${duration(o.median_hours)}` : "entre la publication et la vente"} />
        <Tile k="Prix moyen" v={eurC(o.avg_sold_price_cents ?? o.avg_price_cents, 2)} hint={o.avg_sold_price_cents != null ? "des annonces vendues" : "des annonces vues"} />
        <Tile k="Ventes / jour" v={n2(o.sold_per_day)} hint={`${n2(o.new_per_day)} nouvelles annonces / jour`} />
      </dl>

      <nav className={seg.wrap} aria-label="Vues">
        {TABS.map(([k, l]) => <Link key={k} href={href({ tab: k })} aria-current={k === tab ? "page" : undefined} className={seg.item(k === tab)}>{l}</Link>)}
      </nav>

      {empty ? (
        <Empty>Aucune annonce collectée pour cette recherche. Les chiffres apparaîtront après le premier passage réussi d&apos;un collecteur (voir ci-dessous) : rien n&apos;est estimé ni inventé.</Empty>
      ) : tab === "ventes" ? (
        <section data-testid="sales">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted">Les annonces que Vinted a marquées vendues, la plus récente d&apos;abord.</span>
            <Link href={href({ disparues: sp.disparues ? null : "1" })} className={btn.ghost}>{sp.disparues ? "Masquer les disparues" : "Ajouter les disparues (ventes probables)"}</Link>
          </div>
          <ItemsTable items={(items.data ?? []) as Item[]} sold />
        </section>
      ) : tab === "annonces" ? (
        <section data-testid="listings"><p className="mb-2 text-sm text-muted">Les 200 annonces les plus récentes de la recherche.</p><ItemsTable items={(items.data ?? []) as Item[]} /></section>
      ) : tab === "stats" ? (
        <section className="grid gap-3 lg:grid-cols-2" data-testid="stats">
          <ChartCard title="Activité quotidienne (14 jours)" legend={[["bg-violet-400", "Nouvelles annonces"], ["bg-blue-500", "Ventes vues"]]}>
            <Bars rows={o.daily.map((d) => ({ label: new Date(d.day).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }), a: d.new, b: d.sold }))} />
          </ChartCard>
          <ChartCard title="Temps de vente" legend={[["bg-blue-500", "Annonces vendues"]]}>
            <Bars rows={o.sell_times.map((b) => ({ label: b.label, a: null, b: b.n }))} />
          </ChartCard>
          <ChartCard title="Prix : affichés et vendus" legend={[["bg-violet-400", "Annonces vues"], ["bg-blue-500", "Vendues"]]}>
            <Bars rows={o.prices.map((b) => ({ label: b.label, a: b.listed, b: b.sold }))} />
          </ChartCard>
        </section>
      ) : (
        <GroupsTable rows={(groups.data ?? []) as Group[]} by={tab === "niches" ? "Marque" : "Vendeur"} />
      )}

      <Collectors collectors={collectors} keys={[]} manager={ctx.isManager} supabaseUrl="" anonKey="" searchId={id} />
    </div>
  );
}

function Tile({ k, v, hint, help }: { k: string; v: string; hint?: string; help?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/80 px-3.5 py-3" data-tile={k}>
      <dt className="eyebrow-tight flex items-start gap-1 text-muted">{k}{help && <Help text={help} />}</dt>
      <dd className="figure mt-1 text-[22px] font-semibold leading-tight sm:text-2xl">{v}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}

function ItemsTable({ items, sold }: { items: Item[]; sold?: boolean }) {
  if (!items.length) return <Empty>{sold ? "Aucune vente détectée pour l'instant : il faut que des annonces déjà vues soient revues vendues." : "Aucune annonce."}</Empty>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-panel/80">
      <table className="data min-w-[760px]">
        <thead><tr><th>Annonce</th><th>Marque</th><th>Taille</th><th className="num">Prix</th><th>Publiée</th><th>{sold ? "Vendue" : "État"}</th>{sold && <th className="num">Délai</th>}<th>Vendeur</th></tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.vinted_id} data-item={i.vinted_id}>
              <td><a href={i.url ?? "#"} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:underline">
                <span className="size-9 shrink-0 overflow-hidden rounded-lg bg-fg/5">{/* eslint-disable-next-line @next/next/no-img-element */}
                  {i.photo_url && <img src={i.photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />}</span>
                <span className="max-w-[18rem] truncate">{i.title ?? `Annonce ${i.vinted_id}`}</span></a></td>
              <td>{i.brand ?? "—"}</td><td>{i.size ?? "—"}</td><td className="num figure">{eurC(i.price_cents, 2)}</td>
              <td className="whitespace-nowrap text-muted">{i.listed_exact ? when(i.listed_at) : <>vue le {when(i.first_seen_at)}</>}</td>
              <td className="whitespace-nowrap">{sold ? <>{when(i.ended_at)}{i.state === "gone" && <span className="ml-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs text-amber-200">disparue</span>}</>
                : <StateChip s={i.state} />}</td>
              {sold && <td className="num figure">{i.listed_exact && i.ended_at ? duration((Date.parse(i.ended_at) - Date.parse(i.listed_at)) / 3_600_000) : "—"}</td>}
              <td className="text-muted">{i.seller_login ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function StateChip({ s }: { s: string }) {
  const [l, c] = s === "sold" ? ["Vendue", "bg-blue-400/15 text-blue-200 ring-blue-400/30"] : s === "reserved" ? ["Réservée", "bg-amber-400/15 text-amber-200 ring-amber-400/30"]
    : s === "gone" ? ["Disparue", "bg-zinc-400/15 text-zinc-300 ring-zinc-400/30"] : ["En vente", "bg-emerald-400/15 text-emerald-200 ring-emerald-400/30"];
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${c}`}>{l}</span>;
}

function GroupsTable({ rows, by }: { rows: Group[]; by: string }) {
  if (!rows.length) return <Empty>Pas encore assez d&apos;annonces.</Empty>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-panel/80" data-testid="groups">
      <table className="data min-w-[760px]">
        <thead><tr><th>{by}</th><th className="num">% de vente</th><th className="num">Temps de vente</th><th className="num">Ventes / jour</th><th className="num">Prix moyen</th><th className="num">Annonces vues</th><th className="num">Score</th></tr></thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.key} data-group={g.key}>
              <td className="font-medium">{g.key}</td><td className="num figure">{pct(g.rate)}</td><td className="num figure">{duration(g.avg_hours)}</td>
              <td className="num figure">{n2(g.sold_per_day)}</td><td className="num figure">{eurC(g.avg_price_cents, 2)}</td><td className="num figure">{g.items}</td>
              <td className="num">{g.score == null ? <span className="text-muted">—</span> : <span className={`figure rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${g.score >= 70 ? "bg-emerald-400/15 text-emerald-200 ring-emerald-400/30" : g.score >= 45 ? "bg-amber-400/15 text-amber-200 ring-amber-400/30" : "bg-zinc-400/15 text-zinc-300 ring-zinc-400/30"}`}>{g.score}/100</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line p-3 text-xs text-muted">Pas de score sous 5 annonces ou sans vente : trop peu de données pour juger.</p>
    </div>
  );
}

function ChartCard({ title, legend, children }: { title: string; legend: [string, string][]; children: React.ReactNode }) {
  return (
    <figure className="rounded-2xl border border-line bg-panel/80 p-4">
      <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="section-title">{title}</span>
        <span className="flex gap-3 text-xs text-muted">{legend.map(([c, l]) => <span key={l} className="inline-flex items-center gap-1.5"><span className={`size-2.5 rounded-sm ${c}`} />{l}</span>)}</span></figcaption>
      {children}
    </figure>
  );
}
/** Grouped bars, the value written on each bar (no axis to read) */
function Bars({ rows }: { rows: { label: string; a: number | null; b: number }[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.a ?? 0, r.b]));
  return (
    <div className="flex h-44 items-end gap-1.5" role="img" aria-label={rows.map((r) => `${r.label} : ${r.a != null ? `${r.a} et ` : ""}${r.b}`).join(", ")}>
      {rows.map((r) => (
        <div key={r.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div className="flex h-36 w-full items-end justify-center gap-0.5">
            {r.a != null && <Bar v={r.a} max={max} cls="bg-violet-400" />}
            <Bar v={r.b} max={max} cls="bg-blue-500" />
          </div>
          <span className="w-full truncate text-center text-[10px] text-muted">{r.label}</span>
        </div>
      ))}
    </div>
  );
}
function Bar({ v, max, cls }: { v: number; max: number; cls: string }) {
  return (
    <div className="flex h-full w-full max-w-6 flex-col items-center justify-end">
      <span className="figure text-[10px] text-muted">{v || ""}</span>
      <div className={`w-full rounded-t ${cls}`} style={{ height: `${(v / max) * 100}%`, minHeight: v ? 2 : 0 }} />
    </div>
  );
}
