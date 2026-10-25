import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/session";
import { loadCatalog } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, StatusChip, btn } from "@/components/ui";
import { HOLD_LABEL, STATUS_LABEL } from "@/i18n/fr";
import { cm, dateTime, money } from "@/lib/format";
import type { Item, ItemStatus } from "@/lib/types";
import { ItemEditor } from "./item-editor";
import { ItemActions } from "./item-actions";

const NEXT_STATION: Partial<Record<ItemStatus, { href: string; label: string }>> = {
  received: { href: "/postes/reception", label: "Trier" },
  sorted: { href: "/postes/photo", label: "Photographier" },
  photographed: { href: "/postes/photo", label: "Mesurer" },
  measured: { href: "/postes/rangement", label: "Ranger" },
  returned: { href: "/postes/rangement", label: "Ranger" },
  listing_ready: { href: "/postes/publication", label: "Publier" },
  sold: { href: "/postes/expedition", label: "Expédier" },
};

export default async function ItemPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const ctx = await getContext();
  const supabase = await createClient();
  const { data: item } = await supabase.from("items").select("*").eq("sku", decodeURIComponent(sku).toUpperCase()).maybeSingle();
  if (!item) notFound();

  const [catalog, photos, measures, events, moves, listings, batch, location, cost, sales] = await Promise.all([
    loadCatalog(),
    supabase.from("item_photos").select("*").eq("item_id", item.id).order("position"),
    supabase.from("item_measurements").select("definition_id, value_mm").eq("item_id", item.id),
    supabase.from("item_events").select("*").eq("item_id", item.id).order("created_at", { ascending: false }),
    supabase.from("item_location_moves").select("moved_at, method, to:locations!item_location_moves_to_location_id_fkey(code)").eq("item_id", item.id).order("moved_at", { ascending: false }),
    supabase.from("listings").select("*").eq("item_id", item.id).order("listed_at", { ascending: false }),
    supabase.from("batches").select("id, code").eq("id", item.batch_id).single(),
    item.current_location_id ? supabase.from("locations").select("code").eq("id", item.current_location_id).single() : null,
    ctx.isManager ? supabase.from("item_costs").select("*").eq("item_id", item.id).maybeSingle() : null,
    ctx.isManager ? supabase.from("v_item_economics").select("*").eq("item_id", item.id).maybeSingle() : null,
  ]);
  const { data: members } = await supabase.from("profiles").select("id, full_name");
  const who = new Map((members ?? []).map((m) => [m.id, m.full_name]));
  const paths = (photos.data ?? []).map((p) => p.storage_path);
  const { data: signed } = paths.length ? await supabase.storage.from("item-photos").createSignedUrls(paths, 3600) : { data: [] };

  const it = item as Item;
  const cat = catalog.categories.find((c) => c.id === it.category_id);
  const defs = catalog.definitions.filter((d) => d.template_id === cat?.measurement_template_id).sort((a, b) => a.sort - b.sort);
  const mm = new Map((measures.data ?? []).map((m) => [m.definition_id, m.value_mm]));
  const nextStation = NEXT_STATION[it.status];
  const econ = sales?.data;

  return (
    <>
      <PageHeader
        title={it.sku}
        subtitle={<>Lot <Link className="underline" href={`/lots/${batch.data?.id}`}>{batch.data?.code}</Link> · reçu le {dateTime(it.received_at)} · emplacement <b className="font-mono">{location?.data?.code.replace("EMP-", "") ?? "—"}</b></>}
        actions={
          <>
            <StatusChip status={it.status} large />
            {nextStation && <Link className={btn.primary} href={`${nextStation.href}?sku=${it.sku}`}>{nextStation.label}</Link>}
            <a className={btn.secondary} href={`/etiquettes/articles?skus=${it.sku}`} target="_blank">Étiquette</a>
          </>
        }
      />
      {it.status === "on_hold" && (
        <p className="mb-4 rounded-lg bg-yellow-200 p-3 font-semibold text-yellow-950">
          En attente : {it.hold_reason ? HOLD_LABEL[it.hold_reason] : "—"} (reprendra à « {it.status_before_hold && STATUS_LABEL[it.status_before_hold]} »)
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card title={`Photos (${photos.data?.length ?? 0})`}>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {(photos.data ?? []).map((p, i) => (
                <a key={p.id} href={signed?.[i]?.signedUrl ?? undefined} target="_blank">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={signed?.[i]?.signedUrl ?? undefined} alt={p.shot_key ?? ""} className="aspect-[3/4] w-full rounded object-cover" />
                </a>
              ))}
            </div>
          </Card>
          <Card title="Fiche">
            <ItemEditor item={it} catalog={catalog} orgId={ctx.org.id} locked={["sold", "shipped", "completed"].includes(it.status) && !ctx.isManager} />
          </Card>
          {defs.length > 0 && (
            <Card title="Mesures à plat">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                {defs.map((d) => (<div key={d.id} className="flex justify-between border-b border-line py-1"><dt className="text-muted">{d.label}</dt><dd className="tabular-nums">{cm(mm.get(d.id))}</dd></div>))}
              </dl>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {!["sold", "shipped", "completed"].includes(it.status) && <Card title="Actions"><ItemActions item={it} isManager={ctx.isManager} /></Card>}
          {ctx.isManager && (
            <Card title="Rentabilité">
              <dl className="space-y-1 text-sm">
                <Row k="Coût de revient" v={<>{money(cost?.data?.allocated_cost_cents)}{cost?.data?.manual && " (manuel)"}</>} />
                <Row k="Prix affiché" v={money(it.list_price_cents)} />
                <Row k="Prix minimum" v={money(it.min_price_cents)} />
                {econ?.is_sold && (
                  <>
                    <Row k="Vendu" v={money(econ.revenue_cents)} />
                    <Row k="Frais" v={money(econ.variable_costs_cents + econ.vat_cents)} />
                    <Row k="Marge brute" v={<b>{money(econ.gross_profit_cents)}</b>} />
                    <Row k="Délai de vente" v={econ.days_to_sell != null ? `${Math.round(econ.days_to_sell)} j` : "—"} />
                  </>
                )}
              </dl>
            </Card>
          )}
          <Card title="Annonces">
            {(listings.data ?? []).length === 0 ? <p className="text-sm text-muted">Aucune.</p> : (
              <ul className="space-y-1 text-sm">
                {(listings.data ?? []).map((l) => (
                  <li key={l.id}>{l.channel} · {l.status} · {money(l.price_cents)} {l.url && <a className="text-accent underline" href={l.url} target="_blank" rel="noreferrer">ouvrir</a>}</li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Historique">
            <ol className="space-y-2 text-sm">
              {(events.data ?? []).map((e) => (
                <li key={e.id} className="border-l-2 border-accent pl-3">
                  <div className="font-medium">{e.from_status ? `${STATUS_LABEL[e.from_status as ItemStatus]} → ` : ""}{STATUS_LABEL[e.to_status as ItemStatus]}</div>
                  <div className="text-xs text-muted">{dateTime(e.created_at)} · {who.get(e.actor_id) || "—"}{e.payload?.reason ? ` · ${e.payload.reason}` : ""}</div>
                </li>
              ))}
              {(moves.data ?? []).map((m, i) => (
                <li key={`m${i}`} className="border-l-2 border-line pl-3 text-xs text-muted">
                  {dateTime(m.moved_at)} · déplacé vers {(m.to as unknown as { code: string })?.code.replace("EMP-", "")} ({m.method})
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between"><dt className="text-muted">{k}</dt><dd className="tabular-nums">{v}</dd></div>;
}
