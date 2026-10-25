import { getContext } from "@/lib/session";
import { loadCatalog } from "@/lib/catalog";
import { PhotoStation } from "./station";

export default async function Page({ searchParams }: { searchParams: Promise<{ sku?: string }> }) {
  const ctx = await getContext();
  const { sku } = await searchParams;
  return <PhotoStation catalog={await loadCatalog()} orgId={ctx.org.id} minPhotos={ctx.org.min_photos} initialSku={sku ?? null} />;
}
