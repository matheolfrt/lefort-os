import { requireManager } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { SalesImport } from "./sales-import";

export default async function Page() {
  await requireManager();
  return (
    <>
      <PageHeader back="/ventes" title="Importer des ventes" subtitle="Chaque ligne vend un article existant, avec les mêmes contrôles qu'une saisie manuelle." />
      <SalesImport />
    </>
  );
}
