import { requireManager } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { SalesImport } from "./sales-import";

export default async function Page() {
  await requireManager();
  return (
    <>
      <PageHeader back="/ventes" title="Importer des ventes" subtitle="Ventes du stock ou d'articles jamais saisis : ils sont créés automatiquement." />
      <SalesImport />
    </>
  );
}
