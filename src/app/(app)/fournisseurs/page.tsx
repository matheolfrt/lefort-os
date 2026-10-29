import Link from "next/link";
import { Plus } from "lucide-react";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Field, PageHeader, btn, input } from "@/components/ui";
import { judge, type SupplierRow } from "@/lib/suppliers";
import { createSupplier } from "./actions";
import { SupplierCard } from "./supplier-card";

export const metadata = { title: "Fournisseurs" };

export default async function Suppliers({ searchParams }: { searchParams: Promise<{ error?: string; nouveau?: string; archive?: string }> }) {
  const ctx = await requireManager();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("supplier_stats");
  if (error || !data) {
    return (
      <>
        <PageHeader title="Fournisseurs" />
        <Empty action={{ href: "/parametres/mises-a-jour", label: "Mettre à jour la base" }}>
          La nouvelle page Fournisseurs a besoin d&apos;une mise à jour de la base de données.
        </Empty>
      </>
    );
  }
  const target = ctx.org.sellthrough_target_pct ?? 80;
  const { list, ref } = judge((data as { suppliers: SupplierRow[] }).suppliers, target);
  const active = list.filter((s) => s.active && s.verdict !== "stock");
  const opening = list.filter((s) => s.active && s.verdict === "stock");
  const archived = list.filter((s) => !s.active);
  const ranked = active.filter((s) => s.verdict !== "few");
  const early = active.filter((s) => s.verdict === "few" && s.batches > 0);
  const noLot = active.filter((s) => s.verdict === "few" && s.batches === 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Fournisseurs"
        subtitle="Où racheter : la marge est mesurée sur ce qui est vendu, le stock restant n'est pas compté comme une perte."
        actions={<a href="#nouveau" className={btn.primary}><Plus size={18} /> Nouveau fournisseur</a>} />
      {sp.error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">{sp.error}</p>}
      {sp.archive && <p role="status" className="rounded-xl bg-accent/10 p-3 text-sm text-accent">Fournisseur archivé : il reste dans « Archivés » avec son historique.</p>}

      {ref.marginPerSold != null && (
        <p className="text-sm text-muted">
          Repère : en moyenne, un article vendu rapporte <strong className="text-fg">{Math.round(ref.marginPerSold / 100)} €</strong> de marge
          {ref.avgDays != null && <> et part en <strong className="text-fg">{Math.round(ref.avgDays)} jours</strong></>}. Un fournisseur est « à racheter » à 20 % au-dessus, s&apos;il vend aussi vite.
        </p>
      )}

      {ranked.length > 0 && (
        <section aria-labelledby="ranked" className="space-y-2">
          <h2 id="ranked" className="section-title">Classement</h2>
          <div className="grid gap-3 lg:grid-cols-2">{ranked.map((s) => <SupplierCard key={s.id} s={s} target={target} />)}</div>
        </section>
      )}
      {early.length > 0 && (
        <section aria-labelledby="early" className="space-y-2">
          <h2 id="early" className="section-title">Trop tôt pour juger · {early.length}</h2>
          <div className="grid gap-3 lg:grid-cols-2">{early.map((s) => <SupplierCard key={s.id} s={s} target={target} />)}</div>
        </section>
      )}
      {noLot.length > 0 && (
        <section aria-labelledby="nolot" className="space-y-2">
          <h2 id="nolot" className="section-title">Sans lot pour l&apos;instant · {noLot.length}</h2>
          <ul className="flex flex-wrap gap-2">
            {noLot.map((s) => (
              <li key={s.id}><Link href={`/fournisseurs/${s.id}`} data-supplier={s.name}
                className="inline-flex min-h-11 items-center rounded-xl border border-line bg-panel/70 px-3 text-sm hover:border-fg/25">{s.name}</Link></li>
            ))}
          </ul>
        </section>
      )}
      {!ranked.length && !early.length && !noLot.length && <Empty>Ajoutez votre premier fournisseur ci-dessous, puis créez un lot chez lui.</Empty>}
      {opening.length > 0 && (
        <section aria-labelledby="opening" className="space-y-2">
          <h2 id="opening" className="section-title">Hors classement</h2>
          <div className="grid gap-3 lg:grid-cols-2">{opening.map((s) => <SupplierCard key={s.id} s={s} target={target} />)}</div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Nouveau fournisseur">
          <form id="nouveau" action={createSupplier} className="grid scroll-mt-24 gap-3 sm:grid-cols-2">
            <Field label="Nom"><input className={input} name="name" required autoFocus={sp.nouveau === "1"} /></Field>
            <Field label="Pays"><input className={input} name="country" placeholder="France" /></Field>
            <div className="sm:col-span-2"><Field label="Contact"><input className={input} name="contact" placeholder="Téléphone, e-mail, site…" /></Field></div>
            <div className="sm:col-span-2"><Field label="Notes"><textarea className={`${input} min-h-20 py-2`} name="notes" placeholder="Conditions, prix au kilo, qualité…" /></Field></div>
            <fieldset className="grid gap-3 rounded-xl border border-line p-3 sm:col-span-2 sm:grid-cols-2">
              <legend className="px-1 text-sm font-medium">Un produit qui me plaît <span className="font-normal text-muted">(facultatif)</span></legend>
              <div className="sm:col-span-2"><Field label="Lien du produit"><input className={input} name="product_url" inputMode="url" placeholder="https://…" /></Field></div>
              <Field label="Référence"><input className={input} name="product_ref" placeholder="Ex. Blazer laine Boss 12345" /></Field>
              <Field label="Prix vu (€)"><input className={input} name="product_price" inputMode="decimal" placeholder="Ex. 18" /></Field>
            </fieldset>
            <button className={`${btn.primary} sm:col-span-2`}>Ajouter</button>
          </form>
        </Card>
        {archived.length > 0 && (
          <Card title={`Archivés · ${archived.length}`}>
            <ul className="divide-y divide-line">
              {archived.map((s) => (
                <li key={s.id}><Link href={`/fournisseurs/${s.id}`} className="flex min-h-11 items-center justify-between gap-3 text-sm hover:text-accent">
                  <span>{s.name}</span><span className="text-xs text-muted">{s.batches} lot{s.batches > 1 ? "s" : ""} · {s.sold} vendus</span>
                </Link></li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
