import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, PageHeader } from "@/components/ui";
import { euro } from "@/lib/finance";

export const metadata = { title: "Articles · Où est mon argent ?" };

const PER_PAGE = 50;
const VIEWS: Record<string, string> = {
  stock: "Tout le stock", active: "Stock actif", dormant: "Stock dormant", unpriced: "Articles sans prix", age: "Stock par âge",
};
const SORTS = [{ key: "cost", label: "Coût" }, { key: "age", label: "Âge" }, { key: "price", label: "Prix" }] as const;
const PLATFORM: Record<string, string> = { vinted: "Vinted", ebay: "eBay", etsy: "Etsy", leboncoin: "Leboncoin", direct: "Vente directe" };

interface Row {
  id: string; sku: string; title: string | null; brand: string | null; category: string | null; size: string | null; status: string;
  cost_cents: number; price_cents: number | null; age: number; location: string | null; platform: string | null; url: string | null;
  suggested_cents: number | null; suggest_todo: boolean | null; held_by: string | null;
}
interface Result { total: number; cost_cents: number; price_cents: number; dead_stock_days: number; rows: Row[] }

export default async function FinanceItems({ searchParams }: {
  searchParams: Promise<{ vue?: string; min?: string; max?: string; tri?: string; page?: string }>;
}) {
  await requireManager();
  const sp = await searchParams;
  const vue = sp.vue && VIEWS[sp.vue] ? sp.vue : "stock";
  const tri = SORTS.some((s) => s.key === sp.tri) ? sp.tri! : "cost";
  const min = sp.min != null && /^\d+$/.test(sp.min) ? Number(sp.min) : null;
  const max = sp.max != null && /^\d+$/.test(sp.max) ? Number(sp.max) : null;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_items", {
    p_view: vue, p_min: min, p_max: max, p_sort: tri, p_limit: PER_PAGE, p_offset: (page - 1) * PER_PAGE,
  });
  if (error || !data) {
    return (
      <>
        <PageHeader title="Articles" back="/finance" />
        <Empty action={{ href: "/parametres/mises-a-jour", label: "Mettre à jour la base" }}>Cette page a besoin d&apos;une mise à jour de la base de données.</Empty>
      </>
    );
  }
  const r = data as Result;
  const pages = Math.max(1, Math.ceil(r.total / PER_PAGE));
  const title = vue === "age" ? (max == null ? `Stock de plus de ${(min ?? 1) - 1} jours` : `Stock de ${min ?? 0} à ${max} jours`)
    : vue === "dormant" ? `Stock dormant (plus de ${r.dead_stock_days} jours)` : vue === "active" ? `Stock actif (${r.dead_stock_days} jours ou moins)` : VIEWS[vue];
  const href = (p: Record<string, string | number | null>) => {
    const q = new URLSearchParams();
    const all = { vue, min, max, tri, page: null as number | null, ...p };
    for (const [k, v] of Object.entries(all)) if (v != null && !(k === "page" && v === 1)) q.set(k, String(v));
    return `/finance/articles?${q}`;
  };

  return (
    <div className="space-y-4">
      <PageHeader title={title} back="/finance"
        subtitle="Les articles derrière le chiffre. L'âge compte depuis la mise en ligne (ou la réception), selon vos paramètres financiers." />

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Vue">
        {(["stock", "active", "dormant", "unpriced"] as const).map((v) => (
          <Link key={v} prefetch={false} href={href({ vue: v, min: null, max: null })} role="tab" aria-selected={vue === v}
            className={`inline-flex min-h-10 items-center rounded-lg px-3 text-sm ${vue === v ? "bg-accent/15 font-medium text-accent" : "text-muted hover:text-fg"}`}>{VIEWS[v]}</Link>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2" data-testid="items-totals">
        <Total k="Articles" v={String(r.total)} />
        <Total k="Au coût" v={euro(r.cost_cents)} />
        <Total k="Au prix affiché" v={euro(r.price_cents)} />
      </div>

      {r.rows.length ? (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-panel/80">
            <table className="data min-w-[980px]" data-testid="items">
              <thead>
                <tr>
                  <th>SKU</th><th>Marque</th><th>Catégorie</th>
                  {SORTS.map((s) => (
                    <th key={s.key} className="num">
                      <Link prefetch={false} href={href({ tri: s.key })} className={tri === s.key ? "text-accent" : "hover:text-fg"}>{s.label}{tri === s.key && " ↓"}</Link>
                    </th>
                  ))}
                  <th title="Données non enregistrées pour l'instant">Vues · favoris · offres</th>
                  <th>Plateforme</th><th>Emplacement</th><th>Recommandation</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((x) => (
                  <tr key={x.id}>
                    <td><Link prefetch={false} href={`/stock/${encodeURIComponent(x.sku)}`} className="font-mono font-semibold hover:text-accent">{x.sku}</Link></td>
                    <td className="max-w-[10rem] truncate">{x.brand ?? <span className="text-muted">—</span>}</td>
                    <td className="max-w-[10rem] truncate">{x.category ?? <span className="text-muted">—</span>}{x.size && <span className="text-muted"> · {x.size}</span>}</td>
                    <td className="num">{euro(x.cost_cents)}</td>
                    <td className={`num ${x.age > r.dead_stock_days ? "text-amber-300" : ""}`}>{x.age} j</td>
                    <td className="num">{x.price_cents == null ? <span className="text-muted">sans prix</span> : euro(x.price_cents)}</td>
                    <td className="text-xs text-muted">non disponible</td>
                    <td>
                      {x.platform ? (x.url
                        ? <a href={x.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent">{PLATFORM[x.platform] ?? x.platform}<ExternalLink size={12} /></a>
                        : PLATFORM[x.platform] ?? x.platform) : <span className="text-muted">non publié</span>}
                    </td>
                    <td className="font-mono text-xs">{x.location ?? <span className="text-muted">—</span>}</td>
                    <td className="text-xs">{recommendation(x, r.dead_stock_days)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <nav aria-label="Pages" className="flex items-center justify-between gap-2 text-sm">
              {page > 1 ? <Link prefetch={false} href={href({ page: page - 1 })} className="inline-flex min-h-11 items-center text-accent hover:underline">← Précédents</Link> : <span />}
              <span className="text-muted">Page {page} sur {pages}</span>
              {page < pages ? <Link prefetch={false} href={href({ page: page + 1 })} className="inline-flex min-h-11 items-center text-accent hover:underline">Suivants →</Link> : <span />}
            </nav>
          )}
        </>
      ) : <Empty>{page > 1 ? "Plus d'articles sur cette page." : "Aucun article dans cette vue."}</Empty>}
    </div>
  );
}

/** What to do with the item: the price rule's suggestion first (never applied automatically), else what is missing */
function recommendation(x: Row, dead: number) {
  if (x.price_cents == null) return <Link prefetch={false} href={`/stock/${encodeURIComponent(x.sku)}`} className="text-amber-300 hover:underline">Fixer un prix</Link>;
  if (!x.platform && x.status !== "reserved") return <span className="text-amber-300">À publier</span>;
  if (x.suggest_todo && x.suggested_cents != null && x.suggested_cents < x.price_cents)
    return <Link prefetch={false} href="/prix" className="text-amber-300 hover:underline">Baisser à {euro(x.suggested_cents)}</Link>;
  if (x.held_by) return <span className="text-muted">Prix au plancher</span>;
  if (x.age > dead) return <span className="text-muted">Dormant : envisager un lot ou une autre plateforme</span>;
  return <span className="text-muted">—</span>;
}

function Total({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/80 p-3">
      <div className="eyebrow-tight text-muted">{k}</div>
      <div className="font-mono text-lg font-semibold tabular-nums">{v}</div>
    </div>
  );
}
