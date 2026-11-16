import Link from "next/link";
import { Card, Empty, PageHeader, Stat, seg } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/session";
import { eur } from "@/lib/advisor";
import { BUNDLE_MIN_AGE, BUNDLE_SHARE, HARRIS_MIN_AGE, proposeBundles } from "@/lib/kpi/bundles";
import { enrich } from "@/lib/kpi/compute";
import { loadKpi } from "@/lib/kpi/load";
import { CopyButton } from "./copy-button";

export const metadata = { title: "Lots groupés" };
const AGES = [60, 90, 120] as const;

/** « Lots groupés » : the listings that sleep, proposed in lots of 3 or 4 of the same kind and size, ready to paste into Vinted */
export default async function LotsGroupes({ searchParams }: { searchParams: Promise<{ age?: string }> }) {
  await requireManager();
  const sp = await searchParams;
  const minAge = (AGES as readonly number[]).includes(Number(sp.age)) ? Number(sp.age) : BUNDLE_MIN_AGE;
  const supabase = await createClient();
  let data;
  try { data = await loadKpi(supabase); }
  catch (e) { return <div><PageHeader title="Lots groupés" /><Card>Données indisponibles : {(e as Error).message}</Card></div>; }
  const p = proposeBundles(enrich(data.items), Date.now(), minAge);
  const pieces = p.bundles.reduce((s, b) => s + b.pieces.length, 0);
  const revenue = p.bundles.reduce((s, b) => s + b.price, 0), margin = p.bundles.reduce((s, b) => s + b.margin, 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Lots groupés"
        subtitle="Les annonces qui dorment, regroupées par type et par taille en lots de 3 ou 4. Rien n'est modifié ici : copiez le texte et créez l'annonce du lot sur Vinted."
        actions={
          <nav aria-label="Ancienneté minimum" className={seg.wrap}>
            {AGES.map((a) => (
              <Link key={a} href={a === BUNDLE_MIN_AGE ? "/lots-groupes" : `/lots-groupes?age=${a}`} aria-current={a === minAge ? "true" : undefined} className={seg.item(a === minAge)}>+ de {a} j</Link>
            ))}
          </nav>
        } />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Lots proposés" value={p.bundles.length} hint={`${pieces} pièces sur ${p.candidates} en ligne depuis plus de ${minAge} jours`} />
        <Stat label="Si tous se vendent" value={eur(revenue)} hint={`${eur(margin)} après le prix d'achat`}
          help={`Prix d'un lot : ${Math.round(BUNDLE_SHARE * 100)} % de la somme des prix affichés, arrondi à 5 €, et jamais moins que le prix d'achat des pièces + 5 € par pièce.`} />
        <Stat label="Pièces qui attendent" value={p.left} hint="pas assez de pièces du même type et de la même taille"
          help="Il faut au moins 3 pièces du même type (blazers, manteaux ou costumes) et de la même taille pour proposer un lot." />
        <Stat label="Règles" value="3 ou 4" hint={`par lot · Harris après ${HARRIS_MIN_AGE} jours · les pièces de marque restent seules`} />
      </div>

      {p.bundles.length === 0 ? (
        <Empty action={{ href: "/prix", label: "Voir les prix à baisser" }}>
          Aucun lot à proposer : il n&apos;y a pas 3 pièces du même type et de la même taille en ligne depuis plus de {minAge} jours.
        </Empty>
      ) : (
        <ol className="space-y-3">
          {p.bundles.map((b, n) => (
            <li key={b.key}>
              <article className="glass rounded-2xl p-4 sm:p-5" data-bundle={b.key}>
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="eyebrow-tight text-muted">Lot {n + 1} · la plus ancienne en ligne depuis {b.oldest} jours</div>
                    <h2 className="mt-0.5 text-lg font-semibold leading-snug">{b.title}</h2>
                  </div>
                  <div className="text-right">
                    <div className="figure text-[28px] font-semibold leading-none tabular-nums">{eur(b.price)}</div>
                    <div className="mt-1 text-xs text-muted">{eur(b.perPiece)} la pièce · au lieu de {eur(b.sumList)} · marge {eur(b.margin)}</div>
                  </div>
                </header>
                <ul className="mt-3 divide-y divide-line rounded-xl border border-line text-sm">
                  {b.pieces.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                      <Link prefetch={false} href={`/stock/${encodeURIComponent(x.sku)}`} className="-my-2 inline-block py-2 font-mono font-semibold hover:text-accent">{x.sku}</Link>
                      <span className="min-w-0 flex-1 truncate text-muted">{x.title}</span>
                      <span className="tabular-nums text-muted">{x.age} j</span>
                      <span className="w-16 text-right tabular-nums">{eur(x.listPrice)}</span>
                    </li>
                  ))}
                </ul>
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer font-medium text-accent">Voir la description du lot</summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-[var(--fill)] p-3 font-sans text-sm">{b.description}</pre>
                </details>
                <footer className="mt-3 flex flex-wrap gap-2">
                  <CopyButton text={b.title} label="Le titre" />
                  <CopyButton text={b.description} label="La description" />
                </footer>
              </article>
            </li>
          ))}
        </ol>
      )}

      <Card title="Comment faire sur Vinted">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Créez une nouvelle annonce avec les photos des pièces du lot, collez le titre et la description, mettez le prix du lot.</li>
          <li>Laissez les annonces à l&apos;unité en ligne : la première vente décide. La description du lot garde les références de chaque pièce.</li>
          <li>Quand le lot est vendu, enregistrez la vente avec ses pièces dans Ventes, puis retirez leurs annonces à l&apos;unité.</li>
        </ol>
      </Card>
    </div>
  );
}
