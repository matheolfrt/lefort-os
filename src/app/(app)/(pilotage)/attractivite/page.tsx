import Link from "next/link";
import { ExternalLink, Eye, Heart, MessageCircle } from "lucide-react";
import { Card, Empty, PageHeader, SkuLink, Stat, chip } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/session";
import { money } from "@/lib/format";
import { VERDICT, VERDICT_ORDER, analyse, type ListingIn, type Refs, type Row, type Segment, type StatPoint, type Verdict } from "@/lib/listing-performance";

export const metadata = { title: "Attractivité des annonces" };

const PAGE = 1000;
const SHOWN = 8;
const TONE: Record<string, string> = {
  emerald: "bg-emerald-400/10 text-emerald-200 ring-emerald-400/25",
  amber: "bg-amber-400/10 text-amber-200 ring-amber-400/25",
  red: "bg-red-400/10 text-red-200 ring-red-400/25",
  zinc: "bg-fg/5 text-muted ring-line",
};
const TO_ACT: Verdict[] = ["offer", "liked", "unseen", "unliked"];

const n1 = (v: number | null) => (v == null ? "—" : v.toLocaleString("fr-FR", { maximumFractionDigits: v < 10 ? 1 : 0 }));
const n0 = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString("fr-FR"));

type ListingRow = {
  external_id: string; state: ListingIn["state"]; title: string | null; url: string | null; photo: string | null;
  price_cents: number | null; brand: string | null; views: number | null; favourites: number | null; offers: number | null;
  first_seen_at: string;
  items: { sku: string; listed_at: string | null; categories: { name: string } | null; brands: { name: string } | null } | null;
};

/** Every row of a query, page by page */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { rows, error: error.message };
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return { rows, error: null };
  }
}

export default async function Attractivite({ searchParams }: { searchParams: Promise<{ voir?: string }> }) {
  await requireManager();
  const sp = await searchParams;
  const supabase = await createClient();
  const now = new Date();
  const dayAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString().slice(0, 10);

  const [listings, history] = await Promise.all([
    all<ListingRow>((from, to) => supabase.from("vinted_listings")
      .select("external_id, state, title, url, photo, price_cents, brand, views, favourites, offers, first_seen_at, items(sku, listed_at, categories(name), brands(name))")
      .in("state", ["active", "reserved", "sold"]).order("external_id").range(from, to) as unknown as PromiseLike<{ data: ListingRow[] | null; error: { message: string } | null }>),
    // what each listing had a week ago (the sync reads the wardrobe a few times a day)
    all<{ external_id: string; day: string; views: number | null; favourites: number | null; offers: number | null }>((from, to) =>
      supabase.from("vinted_listing_stats").select("external_id, day, views, favourites, offers")
        .gte("day", dayAgo(21)).lte("day", dayAgo(7)).order("external_id").order("day").range(from, to)),
  ]);

  if (listings.error) {
    return (
      <>
        <PageHeader title="Attractivité des annonces" />
        <Empty action={{ href: "/parametres/mises-a-jour", label: "Mettre à jour la base" }}>
          Les annonces Vinted ne sont pas lisibles ({listings.error}). La base a peut-être besoin d&apos;une mise à jour.
        </Empty>
      </>
    );
  }

  const input: ListingIn[] = listings.rows.map((l) => ({
    ext: l.external_id, state: l.state, title: l.title, url: l.url, photo: l.photo, price: l.price_cents,
    views: l.views, favourites: l.favourites, offers: l.offers,
    since: l.items?.listed_at ?? l.first_seen_at,
    sku: l.items?.sku ?? null,
    brand: l.items?.brands?.name ?? l.brand,
    category: l.items?.categories?.name ?? null,
  }));
  const stats: StatPoint[] = history.rows.map((s) => ({ ext: s.external_id, day: s.day, views: s.views, favourites: s.favourites, offers: s.offers }));
  const p = analyse(input, stats, now);
  const online = p.rows.length;

  if (p.withStats === 0) {
    return (
      <div className="space-y-5">
        <Header />
        <Empty action={{ href: "/ventes/vinted", label: "Voir la synchro Vinted" }}>
          {listings.rows.length
            ? "Les annonces sont là, mais pas encore leurs vues ni leurs favoris."
            : "Aucune annonce Vinted lue pour l'instant."}{" "}
          L&apos;extension Chrome les lit dans votre dressing toutes les 6 heures : laissez Chrome ouvert,
          ou lancez « Synchroniser maintenant » dans l&apos;extension. Les chiffres apparaîtront ici ensuite.
        </Empty>
      </div>
    );
  }

  const toAct = TO_ACT.reduce((a, v) => a + p.counts[v], 0);
  const focus = VERDICT_ORDER.includes(sp.voir as Verdict) ? (sp.voir as Verdict) : null;

  return (
    <div className="space-y-6">
      <Header />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="À traiter" value={toAct} hint={`sur ${online} annonce${online > 1 ? "s" : ""} en ligne`}
          help="Annonces avec une offre, beaucoup de favoris, trop peu de vues, ou des vues sans favoris. Les annonces de moins de 7 jours ne sont pas jugées." />
        <Stat label="Vues par jour" value={n1(p.refs.viewsPerDay)} hint="pour une annonce typique"
          help="Médiane des vues par jour des annonces en ligne depuis 7 jours ou plus. Une annonce sous la moitié de ce chiffre est « peu vue »." />
        <Stat label="Favoris pour 100 vues" value={n1(p.refs.favRate)} hint={p.refs.soldCount >= 5 ? "sur vos annonces vendues" : "sur vos annonces en ligne"}
          help="Combien de personnes sur 100 qui voient l'annonce la mettent en favori. Pris sur vos ventes quand il y en a au moins 5. Sous la moitié : « vue mais pas aimée » (à partir de 30 vues)." />
        <Stat label="Vues pour une vente" value={n0(p.refs.soldViews)}
          hint={p.refs.soldViews != null ? `et ${n0(p.refs.soldFavourites)} favoris, sur ${p.refs.soldCount} vente${p.refs.soldCount > 1 ? "s" : ""}` : "pas encore de vente lue"}
          help="Ce qu'une annonce vendue avait rassemblé au moment de la vente (médiane) : une annonce qui a déjà autant de favoris sans être vendue est « aimée mais pas achetée »." />
      </div>

      {/* the listings to act on, the most urgent first */}
      <section aria-labelledby="a-traiter" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="a-traiter" className="section-title">{focus && !TO_ACT.includes(focus) ? "Autres annonces" : "Annonces à traiter"}</h2>
          {focus && <Link href="/attractivite" className="text-sm text-series-1 hover:underline">Tout afficher</Link>}
        </div>
        {toAct === 0 && !focus ? (
          <Card><p className="text-sm text-muted">Rien à signaler : toutes les annonces jugeables sont dans la normale de votre boutique.</p></Card>
        ) : (
          (focus ? [focus] : TO_ACT).filter((v) => p.counts[v] > 0 || v === focus).map((v) => (
            <VerdictGroup key={v} v={v} rows={p.rows.filter((r) => r.verdict === v)} refs={p.refs} all={focus === v} />
          ))
        )}
        {!focus && (p.counts.fine > 0 || p.counts.new > 0) && (
          <p className="text-sm text-muted">
            {p.counts.fine > 0 && <Link href="/attractivite?voir=fine#a-traiter" className="text-series-1 hover:underline">{p.counts.fine} dans la normale</Link>}
            {p.counts.fine > 0 && p.counts.new > 0 && " · "}
            {p.counts.new > 0 && <Link href="/attractivite?voir=new#a-traiter" className="text-series-1 hover:underline">{p.counts.new} trop récente{p.counts.new > 1 ? "s" : ""} pour juger</Link>}
          </p>
        )}
      </section>

      <Card title="De la vue à la vente">
        <Funnel views={p.funnel.views} favourites={p.funnel.favourites} sold={p.funnel.sold} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <SegmentTable title="Par marque" rows={p.brands} refs={p.refs} />
        <SegmentTable title="Par catégorie" rows={p.categories} refs={p.refs} />
      </div>

      <p className="text-xs text-muted">
        Chiffres lus sur Vinted par l&apos;extension, comparés à vos propres annonces : rien n&apos;est deviné. L&apos;âge d&apos;une annonce compte depuis
        sa mise en ligne dans Lefort OS, ou depuis sa première lecture si elle n&apos;est reliée à aucun article.
      </p>
    </div>
  );
}

function Header() {
  return (
    <PageHeader title="Attractivité des annonces"
      subtitle="Pourquoi un article ne se vend pas : vues, favoris et offres de chaque annonce, comparés à ce qui se vend chez vous." />
  );
}

function VerdictGroup({ v, rows, refs, all }: { v: Verdict; rows: Row[]; refs: Refs; all: boolean }) {
  const d = VERDICT[v];
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${chip} ${TONE[d.tone]}`}>{d.name}</span>
        <span className="figure text-sm font-semibold tabular-nums">{rows.length}</span>
      </div>
      <p className="mt-1.5 text-sm">{d.action}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Aucune annonce.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {shown.map((r) => <ListingLine key={r.ext} r={r} refs={refs} />)}
        </ul>
      )}
      {!all && rows.length > SHOWN && (
        <Link href={`/attractivite?voir=${v}#a-traiter`} className="mt-1 inline-flex min-h-11 items-center text-sm text-series-1 hover:underline">
          Voir les {rows.length} annonces
        </Link>
      )}
    </Card>
  );
}

function ListingLine({ r, refs }: { r: Row; refs: Refs }) {
  // the figure that explains the verdict stands out
  const weakViews = r.verdict === "unseen";
  const weakRate = r.verdict === "unliked";
  const strongFav = r.verdict === "liked";
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="size-12 shrink-0 overflow-hidden rounded-xl bg-[var(--fill)]">
        {/* eslint-disable-next-line @next/next/no-img-element -- Vinted's photo, as it is */}
        {r.photo && <img src={r.photo} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{r.title ?? "Sans titre"}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
          {r.sku ? <SkuLink sku={r.sku} /> : <span>non reliée</span>}
          {r.price != null && <span className="tabular-nums">{money(r.price)}</span>}
          <span>{r.age} j en ligne</span>
          {r.state === "reserved" && <span className="text-amber-200">réservée</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs tabular-nums">
          <span className={`inline-flex items-center gap-1 ${weakViews ? "font-semibold text-amber-200" : "text-muted"}`}
            title={`${r.views ?? 0} vues depuis la mise en ligne`}>
            <Eye size={13} aria-hidden /> {n1(r.viewsPerDay)} /j
            {weakViews && refs.viewsPerDay != null && <span className="font-normal text-muted">(normale {n1(refs.viewsPerDay)})</span>}
            {r.views7 != null && <span className="font-normal text-muted">· +{r.views7} en 7 j</span>}
          </span>
          <span className={`inline-flex items-center gap-1 ${strongFav ? "font-semibold text-emerald-200" : weakRate ? "font-semibold text-red-200" : "text-muted"}`}>
            <Heart size={13} aria-hidden /> {r.favourites ?? 0}
            {r.favRate != null && <span className={weakRate ? "" : "font-normal"}>({n1(r.favRate)} pour 100 vues{weakRate && refs.favRate != null ? `, normale ${n1(refs.favRate)}` : ""})</span>}
          </span>
          {(r.offers ?? 0) > 0 && (
            <span className={`inline-flex items-center gap-1 ${r.verdict === "offer" ? "font-semibold text-emerald-200" : "text-muted"}`}>
              <MessageCircle size={13} aria-hidden /> {r.offers} offre{(r.offers ?? 0) > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
      {r.url && (
        <a href={r.url} target="_blank" rel="noreferrer" aria-label={`Ouvrir sur Vinted : ${r.title ?? r.ext}`}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-series-1 hover:bg-[var(--fill)]">
          <ExternalLink size={17} />
        </a>
      )}
    </li>
  );
}

function Funnel({ views, favourites, sold }: { views: number; favourites: number; sold: number }) {
  const favRate = views ? (favourites * 100) / views : null;
  const perSale = sold ? favourites / sold : null;
  const step = (label: string, value: number) => (
    <div className="min-w-0 flex-1 rounded-xl bg-[var(--fill)] px-3 py-2.5">
      <div className="eyebrow-tight text-muted">{label}</div>
      <div className="figure text-2xl font-semibold tabular-nums">{value.toLocaleString("fr-FR")}</div>
    </div>
  );
  const arrow = (text: string) => (
    <div className="flex shrink-0 items-center justify-center px-1 text-center text-xs text-muted sm:w-28">
      <span><span aria-hidden className="block text-base leading-none max-sm:inline">→ </span>{text}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
      {step("Vues", views)}
      {arrow(favRate != null ? `${n1(favRate)} sur 100 mettent en favori` : "—")}
      {step("Favoris", favourites)}
      {arrow(perSale != null ? `1 vente pour ${n1(perSale)} favoris` : "pas encore de vente")}
      {step("Ventes", sold)}
    </div>
  );
}

function SegmentTable({ title, rows, refs }: { title: string; rows: Segment[]; refs: Refs }) {
  const low = (v: number | null, ref: number | null) => v != null && ref != null && v < ref * 0.5;
  const high = (v: number | null, ref: number | null) => v != null && ref != null && v > ref * 1.5;
  const cls = (v: number | null, ref: number | null) => (low(v, ref) ? "text-red-200 font-semibold" : high(v, ref) ? "text-emerald-200 font-semibold" : "");
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Il faut au moins 3 annonces d&apos;une même {title === "Par marque" ? "marque" : "catégorie"} pour comparer.</p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="whitespace-nowrap text-left">
                <th className="px-1 py-1.5">{title === "Par marque" ? "Marque" : "Catégorie"}</th>
                <th className="px-1 py-1.5 text-right">En ligne</th>
                <th className="px-1 py-1.5 text-right">Vendues</th>
                <th className="px-1 py-1.5 text-right">Vues /j</th>
                <th className="px-1 py-1.5 text-right" title="Favoris pour 100 vues">Favoris %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.slice(0, 12).map((s) => (
                <tr key={s.name}>
                  <td className="max-w-40 truncate px-1 py-2">{s.name}</td>
                  <td className="px-1 py-2 text-right tabular-nums">{s.online}</td>
                  <td className="px-1 py-2 text-right tabular-nums">{s.sold}</td>
                  <td className={`px-1 py-2 text-right tabular-nums ${cls(s.viewsPerDay, refs.viewsPerDay)}`}>{n1(s.viewsPerDay)}</td>
                  <td className={`px-1 py-2 text-right tabular-nums ${cls(s.favRate, refs.favRate)}`}>{n1(s.favRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">En vert : bien au-dessus de votre normale ; en rouge : moins de la moitié.</p>
        </div>
      )}
    </Card>
  );
}
