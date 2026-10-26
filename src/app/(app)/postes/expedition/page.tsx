import { ShippingStation } from "./station";

export default async function Page({ searchParams }: { searchParams: Promise<{ commande?: string }> }) {
  const { commande } = await searchParams;
  return <ShippingStation initialOrder={commande ?? null} />;
}
