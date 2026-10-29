import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, ExternalLink, Plus, Trash2 } from "lucide-react";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, Field, PageHeader, btn, input } from "@/components/ui";
import { judge, type SupplierRow } from "@/lib/suppliers";
import { addSupplierProduct, addSupplierProducts, deleteSupplierProduct, setSupplierActive, updateSupplier } from "../actions";
import { Payback, VerdictChip } from "../supplier-card";
import { MonthsChart } from "./months-chart";

interface Group { name: string; sold: number; stock: number; rejected: number; profit_cents: number; revenue_cents: number; avg_days: number | null }
interface Lot {
  id: string; code: string; kind: string; status: string; purchased_at: string; paid_cents: number; items: number; sold: number;
  rejected: number; in_stock: number; revenue_cents: number; variable_cents: number; profit_cents: number; matured: number; in_time: number; avg_days: number | null;
}
interface Detail { days: number; batches: Lot[]; brands: Group[]; categories: Group[]; sizes: Group[]; months: { month: string; paid_cents: number; revenue_cents: number; sold: number }[] }

const eur = (c: number | null) => (c == null ? "—" : `${Math.round(c / 100).toLocaleString("fr-FR")} €`);
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v)} %`);
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function Supplier({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; enregistre?: string; cree?: string; produit?: string; produits?: string; retire?: string }>;
}) {
  const ctx = await requireManager();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [stats, detail, products] = await Promise.all([
    supabase.rpc("supplier_stats"), supabase.rpc("supplier_detail", { p_supplier_id: id }),
    // products spotted at this supplier (migration 0024): absent before that database update
    supabase.from("supplier_products").select("id, url, reference, price_cents, note, created_at").eq("supplier_id", id).order("created_at", { ascending: false }),
  ]);
  if (stats.error || detail.error) throw new Error(stats.error?.message ?? detail.error?.message);
  const target = ctx.org.sellthrough_target_pct ?? 80;
  const { list, ref } = judge((stats.data as { suppliers: SupplierRow[] }).suppliers, target);
  const s = list.find((x) => x.id === id);
  const d = detail.data as Detail | null;
  if (!s || !d) notFound();

  const perItem = (g: Group) => (g.sold ? g.profit_cents / g.sold : null);
  // the few lines worth remembering about this supplier
  const learn: string[] = [];
  const sellers = d.brands.filter((b) => b.sold >= 2 && b.name !== "Sans marque").sort((a, b) => (perItem(b) ?? 0) - (perItem(a) ?? 0));
  if (sellers[0]) learn.push(`Meilleure marque : ${sellers[0].name}, ${eur(perItem(sellers[0]))} de marge par article (${sellers[0].sold} vendus${sellers[0].avg_days != null ? ` en ${Math.round(sellers[0].avg_days)} j` : ""}).`);
  const bestCat = d.categories.filter((c) => c.sold >= 2).sort((a, b) => (perItem(b) ?? 0) - (perItem(a) ?? 0))[0];
  if (bestCat) learn.push(`${bestCat.name} : ${eur(perItem(bestCat))} de marge par article sur ${bestCat.sold} ventes.`);
  const stuck = [...d.categories, ...d.brands].filter((g) => g.sold === 0 && g.stock >= 2).sort((a, b) => b.stock - a.stock)[0];
  if (stuck) learn.push(`${stuck.name} : ${stuck.stock} en stock et aucune vente pour l'instant.`);
  const losing = d.brands.filter((b) => b.sold >= 1 && b.profit_cents < 0);
  if (losing.length) learn.push(`À perte : ${losing.slice(0, 3).map((b) => b.name).join(", ")} (le prix de vente ne couvre pas le coût).`);
  if (s.rejectPct != null && s.rejectPct >= 10) learn.push(`${pct(s.rejectPct)} des articles écartés : à négocier dans le prix du prochain lot.`);

  return (
    <div className="space-y-5">
      <PageHeader back="/fournisseurs"
        title={<span className="flex flex-wrap items-center gap-2">{s.name} <VerdictChip v={s.verdict} />{!s.active && <span className="rounded-full bg-fg/5 px-2.5 py-0.5 text-xs text-muted ring-1 ring-inset ring-line">Archivé</span>}</span>}
        subtitle={[s.country, s.contact, s.first_purchase && `client depuis le ${day(s.first_purchase)}`].filter(Boolean).join(" · ")}
        actions={s.active && <Link href={`/lots/nouveau?fournisseur=${s.id}`} className={btn.primary}><Plus size={18} /> Nouveau lot chez lui</Link>} />
      {sp.error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">{sp.error}</p>}
      {(sp.enregistre || sp.cree || sp.produit || sp.produits || sp.retire) && <p role="status" className="rounded-xl bg-accent/10 p-3 text-sm text-accent">{sp.cree ? "Fournisseur ajouté. Ajoutez les produits qui vous plaisent ci-dessous, et créez son premier lot quand vous achetez chez lui." : sp.produit ? "Produit ajouté. Vous pouvez en ajouter un autre." : sp.produits ? `${sp.produits} produit${Number(sp.produits) > 1 ? "s" : ""} ajouté${Number(sp.produits) > 1 ? "s" : ""}.` : sp.retire ? "Produit retiré." : "Enregistré."}</p>}

      <Products supplierId={s.id} rows={(products.data ?? []) as Product[]} missing={!!products.error} focus={!!(sp.produit || sp.cree)} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card>
            <ul className="space-y-1 text-[15px]">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Fig k="Marge par article vendu" v={eur(s.marginPerSold)} hint={ref.marginPerSold != null ? `moyenne ${eur(ref.marginPerSold)}` : undefined} />
              <Fig k="Coût d'un article" v={eur(s.costPerItem)} hint="prix du lot / articles" />
              <Fig k="Prix de vente moyen" v={eur(s.avgSale)} hint={s.multiple != null ? `× ${s.multiple.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} le coût` : undefined} />
              <Fig k={`Vendu en ${d.days} j`} v={pct(s.sellThroughPct)} hint={`objectif ${target} %`} />
              <Fig k="Délai moyen de vente" v={s.avg_days != null ? `${Math.round(s.avg_days)} j` : "—"} hint={ref.avgDays != null ? `moyenne ${Math.round(ref.avgDays)} j` : undefined} />
              <Fig k="Écartés" v={pct(s.rejectPct)} hint={`${s.rejected} sur ${s.items}`} />
            </dl>
            <div className="mt-4"><Payback s={s} /></div>
          </Card>

          {learn.length > 0 && (
            <Card title="Ce qui marche chez lui">
              <ul className="list-disc space-y-1 pl-5 text-sm">{learn.map((l) => <li key={l}>{l}</li>)}</ul>
            </Card>
          )}

          <Card title="Achats et ventes sur 12 mois"><MonthsChart months={d.months} /></Card>

          <Card title={`Lots · ${d.batches.length}`}>
            {d.batches.length === 0 ? <p className="text-sm text-muted">Aucun lot pour l&apos;instant.</p> : (
              <div className="overflow-x-auto">
                <table className="data">
                  <thead><tr><th>Lot</th><th>Acheté</th><th className="num">Payé</th><th className="num">Articles</th><th className="num">Vendus</th><th className="num">En {d.days} j</th><th className="num">Marge</th><th className="num">Remboursé</th></tr></thead>
                  <tbody>
                    {d.batches.map((b) => {
                      const back = b.paid_cents > 0 ? ((b.revenue_cents - b.variable_cents) * 100) / b.paid_cents : null;
                      return (
                        <tr key={b.id}>
                          <td><Link prefetch={false} href={`/lots/${b.id}`} className="font-mono font-semibold hover:text-accent">{b.code}</Link></td>
                          <td className="whitespace-nowrap">{day(b.purchased_at)}</td>
                          <td className="num">{eur(b.paid_cents)}</td>
                          <td className="num">{b.items}{b.rejected > 0 && <span className="text-xs text-muted"> ({b.rejected} écartés)</span>}</td>
                          <td className="num">{b.sold}</td>
                          <td className="num">{b.matured >= 5 ? pct((b.in_time * 100) / b.matured) : <span className="text-muted">en cours</span>}</td>
                          <td className={`num ${b.profit_cents < 0 ? "text-red-300" : ""}`}>{eur(b.profit_cents)}</td>
                          <td className="num">{pct(back)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid gap-4 xl:grid-cols-3">
            <Breakdown title="Marques" rows={d.brands} />
            <Breakdown title="Catégories" rows={d.categories} />
            <Breakdown title="Tailles" rows={d.sizes} />
          </div>
        </div>

        <div className="space-y-4">
          <Card title="Coordonnées et notes">
            <form action={updateSupplier.bind(null, s.id)} className="space-y-3">
              <Field label="Nom"><input className={input} name="name" defaultValue={s.name} required /></Field>
              <Field label="Pays"><input className={input} name="country" defaultValue={s.country ?? ""} /></Field>
              <Field label="Contact"><input className={input} name="contact" defaultValue={s.contact ?? ""} placeholder="Téléphone, e-mail, site…" /></Field>
              <Field label="Notes"><textarea className={`${input} min-h-28 py-2`} name="notes" defaultValue={s.notes ?? ""} placeholder="Conditions, prix au kilo, qualité, délais…" /></Field>
              <button className={`${btn.primary} w-full`}>Enregistrer</button>
            </form>
          </Card>
          <form action={setSupplierActive.bind(null, s.id, !s.active)}>
            <button className={`${btn.secondary} w-full`}>
              {s.active ? <><Archive size={16} /> Archiver (je n&apos;achète plus chez lui)</> : <><ArchiveRestore size={16} /> Réactiver</>}
            </button>
            {s.active && <p className="mt-1 text-xs text-muted">Il disparaît de la liste et des nouveaux lots ; son historique et ses statistiques restent.</p>}
          </form>
        </div>
      </div>
    </div>
  );
}

function Fig({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow-tight text-muted">{k}</dt>
      <dd className="font-mono text-xl font-semibold tabular-nums">{v}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}

/** What sells and what does not at this supplier, one dimension: a compact list that fits a third of the page */
function Breakdown({ title, rows }: { title: string; rows: Group[] }) {
  if (!rows.length) return null;
  return (
    <Card title={title}>
      <div className="mb-1 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 text-[11px] uppercase tracking-wider text-muted">
        <span /><span className="text-right">vendus / stock</span><span className="w-16 text-right">marge / art.</span>
      </div>
      <ul className="divide-y divide-line text-sm">
        {rows.slice(0, 12).map((g) => (
          <li key={g.name} className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3">
            <span className="truncate">{g.name}</span>
            <span className="text-right font-mono tabular-nums">
              {g.sold} <span className="text-muted">/ {g.stock}</span>
              {g.sold === 0 && g.stock >= 2 && <span className="ml-1 text-amber-300" title="En stock, aucune vente">●</span>}
            </span>
            <span className={`w-16 text-right font-mono tabular-nums ${g.sold && g.profit_cents < 0 ? "text-red-300" : ""}`}>{g.sold ? eur(g.profit_cents / g.sold) : "—"}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

interface Product { id: string; url: string; reference: string | null; price_cents: number | null; note: string | null; created_at: string }
// a price seen at a supplier, to the cent (18,50 €)
const price = (c: number) => `${(c / 100).toLocaleString("fr-FR", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`;
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

/** « Produits qui me plaisent »: links to product pages of this supplier, with their reference, to buy them again. As many
 * as wanted, one by one or several at once; always shown, with the way to install it when the database is not updated. */
function Products({ supplierId, rows, missing, focus }: { supplierId: string; rows: Product[]; missing: boolean; focus: boolean }) {
  return (
    <section id="produits" className="scroll-mt-24 rounded-2xl border border-line bg-panel/80 p-4 sm:p-5" data-testid="supplier-products">
      <h2 className="section-title mb-3">Produits qui me plaisent{!missing && <span className="font-normal text-muted"> · {rows.length}</span>}</h2>
      {missing ? (
        <p className="text-sm text-muted" data-testid="products-missing">
          Pour enregistrer les liens des produits repérés chez ce fournisseur, faites d&apos;abord la mise à jour de la base.{" "}
          <Link href="/parametres/mises-a-jour" className="inline-flex min-h-11 items-center font-medium text-series-1 hover:underline">Mettre à jour la base</Link>
        </p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            {rows.length === 0 ? (
              <p className="text-sm text-muted">Aucun produit pour l&apos;instant. Ajoutez les liens des produits repérés chez ce fournisseur, avec leur référence : autant que vous voulez, quand vous voulez.</p>
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((p) => (
                  <li key={p.id} className="flex items-start gap-2 py-2" data-product={p.reference ?? p.url}>
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="group flex min-h-11 min-w-0 flex-1 flex-col justify-center">
                      <span className="flex items-center gap-1.5 font-medium group-hover:text-accent group-hover:underline">
                        <span className="truncate">{p.reference ?? host(p.url)}</span><ExternalLink size={14} className="shrink-0 text-muted" aria-hidden />
                        <span className="sr-only">(ouvre le site du fournisseur)</span>
                      </span>
                      <span className="truncate text-xs text-muted">{host(p.url)}{p.price_cents != null && ` · ${price(p.price_cents)}`}{p.note && ` · ${p.note}`}</span>
                    </a>
                    <form action={deleteSupplierProduct.bind(null, supplierId, p.id)}>
                      <button aria-label={`Retirer ${p.reference ?? host(p.url)}`} className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-red-500/10 hover:text-red-500"><Trash2 size={16} /></button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-3">
            <form action={addSupplierProduct.bind(null, supplierId)} className="space-y-2 rounded-xl bg-bg/40 p-3 ring-1 ring-inset ring-line" data-testid="add-product">
              <div className="text-sm font-semibold">Ajouter un produit</div>
              {/* after an addition the link field is ready for the next one */}
              <Field label="Lien du produit"><input className={input} name="product_url" inputMode="url" placeholder="https://…" required autoFocus={focus} /></Field>
              <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                <Field label="Référence"><input className={input} name="product_ref" placeholder="Ex. Boss 12345" /></Field>
                <Field label="Prix vu (€)"><input className={input} name="product_price" inputMode="decimal" placeholder="18" /></Field>
              </div>
              <Field label="Note"><input className={input} name="product_note" placeholder="Taille, couleur, quantité…" /></Field>
              <button className={`${btn.primary} w-full`}><Plus size={16} /> Ajouter</button>
            </form>
            <details className="rounded-xl ring-1 ring-inset ring-line" data-testid="add-products">
              <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-muted hover:text-fg">Ajouter plusieurs liens d&apos;un coup</summary>
              <form action={addSupplierProducts.bind(null, supplierId)} className="space-y-2 px-3 pb-3">
                <textarea className={`${input} min-h-28 py-2 font-mono text-sm`} name="product_lines" required
                  placeholder={"Un lien par ligne, suivi de sa référence :\nhttps://site.fr/p/12 Blazer Boss 12\nhttps://site.fr/p/34 Veste tweed 34"} />
                <button className={`${btn.secondary} w-full`}><Plus size={16} /> Ajouter tous ces liens</button>
              </form>
            </details>
          </div>
        </div>
      )}
    </section>
  );
}
