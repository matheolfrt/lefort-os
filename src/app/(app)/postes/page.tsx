import Link from "next/link";
import { Camera, PackageCheck, PackageOpen, Send, Warehouse } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";

export default async function Stations() {
  const supabase = await createClient();
  const [{ data: pipeline }, { data: toShip }] = await Promise.all([
    supabase.from("v_pipeline").select("status, items"),
    supabase.rpc("shipping_queue"),
  ]);
  const n = (...s: string[]) => (pipeline ?? []).filter((p) => s.includes(p.status)).reduce((a, p) => a + p.items, 0);
  const orders = new Set((toShip ?? []).map((r: { order_id: string }) => r.order_id)).size;

  const stations = [
    { href: "/postes/reception", title: "Réception & tri", desc: "Étiqueter, catégoriser, trier", count: n("received"), icon: PackageOpen },
    { href: "/postes/photo", title: "Photo & mesures", desc: "Photos, étiquettes, mesures à plat", count: n("sorted", "photographed"), icon: Camera },
    { href: "/postes/rangement", title: "Rangement", desc: "Scanner l'article puis l'emplacement", count: n("measured", "returned"), icon: Warehouse },
    { href: "/postes/publication", title: "Publication", desc: "Texte, prix, mise en ligne Vinted", count: n("listing_ready"), icon: Send },
    { href: "/postes/expedition", title: "Expédition", desc: "Prélever, emballer, expédier", count: orders, icon: PackageCheck },
  ];

  return (
    <>
      <PageHeader title="Postes" subtitle="Ouvrez un poste et traitez les articles un par un." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stations.map(({ href, title, desc, count, icon: Icon }) => (
          <Link key={href} href={href} className="flex items-center gap-4 rounded-xl border border-line bg-panel p-5 hover:border-accent">
            <Icon size={36} className="shrink-0 text-accent" />
            <div className="flex-1">
              <div className="text-lg font-bold">{title}</div>
              <div className="text-sm text-muted">{desc}</div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-black tabular-nums">{count}</div>
              <div className="text-[11px] uppercase text-muted">en attente</div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
