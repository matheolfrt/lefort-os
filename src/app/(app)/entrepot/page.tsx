import { getContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { btn, Card, Empty, PageHeader } from "@/components/ui";
import { capacity, DEFAULT_CONFIG } from "@/lib/warehouse3d/config";
import { createDefaultWarehouse } from "./actions";
import { WarehouseApp } from "./warehouse-app";

export const metadata = { title: "Entrepôt 3D" };

/** « Entrepôt 3D » : the stock as it stands on the shelves, on the existing items and locations */
export default async function Entrepot({ searchParams }: { searchParams: Promise<{ w?: string; error?: string }> }) {
  const { w, error: problem } = await searchParams;
  const ctx = await getContext();
  const supabase = await createClient();
  const { data, error } = await supabase.from("warehouses").select("id, name, is_default").order("is_default", { ascending: false }).order("name");
  if (error) {
    return (
      <>
        <PageHeader title="Entrepôt 3D" />
        <Empty action={ctx.isManager ? { href: "/parametres/mises-a-jour", label: "Mettre à jour la base" } : undefined}>
          L&apos;entrepôt 3D a besoin d&apos;une mise à jour de la base de données{ctx.isManager ? "." : " : demandez-la à un responsable."}
        </Empty>
      </>
    );
  }
  const list = (data ?? []) as { id: string; name: string; is_default: boolean }[];
  if (!list.length) {
    const cap = capacity(DEFAULT_CONFIG);
    return (
      <>
        <PageHeader title="Entrepôt 3D" subtitle="Votre stock tel qu'il est rangé, étagère par étagère." />
        {problem && <p role="alert" className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">{problem}</p>}
        {ctx.isManager ? (
          <Card className="max-w-xl"><form action={createDefaultWarehouse} className="space-y-3" data-testid="w-create">
            <p className="text-sm">
              Créez votre entrepôt avec le modèle de départ : {DEFAULT_CONFIG.room.length * DEFAULT_CONFIG.room.width} m²,
              {" "}{cap.racks} racks, {cap.shelves} étagères de {DEFAULT_CONFIG.shelf.levels} niveaux, {cap.places.toLocaleString("fr-FR")} places.
              Tout se modifie ensuite (dimensions, racks, niveaux, capacité, allées, zones).
            </p>
            <p className="text-sm text-muted">Vos emplacements existants (EMP-A-01-03…) sont repris : aucun article ne change de place.</p>
            <button className={btn.primary}>Créer mon entrepôt</button>
          </form></Card>
        ) : (
          <Empty>Aucun entrepôt n&apos;est encore configuré : demandez à un responsable de le créer.</Empty>
        )}
      </>
    );
  }
  const current = list.find((x) => x.id === w) ?? list[0];
  return <WarehouseApp warehouses={list.map(({ id, name }) => ({ id, name }))} warehouseId={current.id} isManager={ctx.isManager} />;
}
