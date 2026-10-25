import { getContext } from "@/lib/session";
import { loadCatalog } from "@/lib/catalog";
import { ListingStation } from "./station";

export default async function Page({ searchParams }: { searchParams: Promise<{ sku?: string }> }) {
  const ctx = await getContext();
  const { sku } = await searchParams;
  return (
    <ListingStation
      catalog={await loadCatalog()}
      signature={ctx.org.listing_signature}
      isManager={ctx.isManager}
      initialSku={sku ?? null}
    />
  );
}
