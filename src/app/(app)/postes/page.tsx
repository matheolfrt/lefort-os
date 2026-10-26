import Link from "next/link";
import { Camera, ChevronRight, PackageCheck, PackageOpen, Send, Warehouse } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { daysSince } from "@/lib/format";
import { StationScanTile } from "./scan-tile";

export default async function Stations() {
  const supabase = await createClient();
  const [{ data: pipeline }, { data: toShip }] = await Promise.all([
    supabase.from("v_pipeline").select("status, items, oldest_since"),
    supabase.rpc("shipping_queue"),
  ]);
  const rows = (s: string[]) => (pipeline ?? []).filter((p) => s.includes(p.status));
  const n = (...s: string[]) => rows(s).reduce((a, p) => a + p.items, 0);
  const oldest = (...s: string[]) => {
    const dates = rows(s).map((p) => p.oldest_since).filter(Boolean).sort();
    return dates.length ? daysSince(dates[0]) : null;
  };
  const shipRows = (toShip ?? []) as { order_id: string; sold_at: string }[];
  const orders = new Set(shipRows.map((r) => r.order_id)).size;
  const oldestSale = shipRows.map((r) => r.sold_at).sort()[0];

  const stations = [
    { href: "/postes/reception", title: "Réception & tri", desc: "Étiqueter, catégoriser, trier", count: n("received"), age: oldest("received"), icon: PackageOpen },
    { href: "/postes/photo", title: "Photo & mesures", desc: "Photos, étiquettes, mesures à plat", count: n("sorted", "photographed"), age: oldest("sorted", "photographed"), icon: Camera },
    { href: "/postes/rangement", title: "Rangement", desc: "Scanner l'article puis l'emplacement", count: n("measured", "returned"), age: oldest("measured", "returned"), icon: Warehouse },
    { href: "/postes/publication", title: "Publication", desc: "Texte, prix, mise en ligne Vinted", count: n("listing_ready"), age: oldest("listing_ready"), icon: Send },
    { href: "/postes/expedition", title: "Expédition", desc: "Prélever, emballer, expédier", count: orders, age: oldestSale ? daysSince(oldestSale) : null, icon: PackageCheck, unit: "commande" },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header>
        <h1 className="text-[22px] font-bold leading-tight tracking-tight">Postes</h1>
        <p className="text-sm text-muted">Ouvrez un poste et traitez les articles un par un.</p>
      </header>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {stations.map(({ href, title, desc, count, age, icon: Icon, unit }) => (
          <Link key={href} href={href}
            className="group flex min-h-24 items-center gap-4 rounded-xl border border-line bg-panel p-4 transition hover:border-fg/30 active:scale-[0.99]">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-bg text-fg/70 group-hover:text-accent">
              <Icon size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{title}</span>
              <span className="block text-sm text-muted">{desc}</span>
              {count > 0 && age != null && <span className="block text-xs text-muted">plus ancien {age} j</span>}
            </span>
            <span className="text-right">
              <span className={`block text-3xl font-black leading-none tabular-nums ${count ? "" : "text-muted/40"}`}>{count}</span>
              <span className="text-[11px] text-muted">{unit ? `${unit}${count > 1 ? "s" : ""}` : "en attente"}</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-muted/60" />
          </Link>
        ))}
        <StationScanTile />
      </div>
    </div>
  );
}
