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
import { ItemActions, RestoreItem } from "./item-actions";
import { Gallery } from "./gallery";
import { QuickFields } from "./quick-fields";

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

  const [catalog, photos, measures, events, moves, listings, batch, location, cost, sales, locations, { data: members }] = await Promise.all([
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
    supabase.from("locations").select("code, label").eq("active", true).order("pick_order").order("code"),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const who = new Map((members ?? []).map((m) => [m.id, m.full_name]));
  const paths = (photos.data ?? []).map((p) => p.storage_path);
  const { data: signed } = paths.length ? await supabase.storage.from("item-photos").createSignedUrls(paths, 3600) : { data: [] };

  const it = item as Item;
  const cat = catalog.categories.find((c) => c.id === it.category_id);
  const defs = catalog.definitions.filter((d) => d.template_id === cat?.measurement_template_id).sort((a, b) => a.sort - b.sort);
  const mm = new Map((measures.data ?? []).map((m) => [m.definition_id, m.value_mm]));
  const nextStation = NEXT_STATION[it.status];
  const econ = sales?.data;
  const sold = ["sold", "shipped", "completed"].includes(it.status);
  const sellable = ["listed", "reserved", "listing_ready"].includes(it.status) && !it.deleted_at;
  // one history: status changes, actions on the board and moves, newest first
  const timeline = [
    ...(events.data ?? []).map((e) => ({ at: e.created_at as string, text: describe(e), who: who.get(e.actor_id) || "—", main: e.type === "status" })),
    ...(moves.data ?? []).map((m) => ({
      at: m.moved_at as string, who: "", main: false,
      text: `Rangé en ${(m.to as unknown as { code: string })?.code.replace("EMP-", "")}${m.method === "auto" ? " (automatique)" : ""}`,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <>
      <PageHeader
        back="/stock"
        title={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{it.sku}</span><StatusChip status={it.status} large /></span>}
        subtitle={<>Lot <Link className="-my-3 inline-block py-3 underline" href={`/lots/${batch.data?.id}`}>{batch.data?.code}</Link> · reçu le {dateTime(it.received_at)} · emplacement <b className="font-mono">{location?.data?.code.replace("EMP-", "") ?? "—"}</b></>}
        actions={
          <>
            {nextStation && <Link className={btn.primary} href={`${nextStation.href}?sku=${it.sku}`}>{nextStation.label}</Link>}
            {sellable && <Link className={nextStation ? btn.secondary : btn.primary} href={`/ventes?article=${encodeURIComponent(it.sku)}`}>Vendre</Link>}
            <a className={btn.secondary} href={`/etiquettes/articles?skus=${it.sku}`} target="_blank">Étiquette</a>
          </>
        }
      />
      {it.deleted_at && <RestoreItem itemId={it.id} sku={it.sku} isManager={ctx.isManager} />}
      {it.status === "on_hold" && (
        <p className="mb-4 rounded-lg bg-yellow-200 p-3 font-semibold text-yellow-950">
          En attente : {it.hold_reason ? HOLD_LABEL[it.hold_reason] : "—"} (reprendra à « {it.status_before_hold && STATUS_LABEL[it.status_before_hold]} »)
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card title={`Photos (${photos.data?.length ?? 0})`}>
            <Gallery photos={(photos.data ?? []).map((p, i) => ({ url: signed?.[i]?.signedUrl ?? "", label: p.shot_key ?? "" })).filter((p) => p.url)} total={photos.data?.length ?? 0} />
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
          <Card title="En bref">
            <QuickFields item={{ id: it.id, sku: it.sku, status: it.status, list_price_cents: it.list_price_cents, min_price_cents: it.min_price_cents }}
              location={location?.data?.code ?? null} locations={(locations.data ?? []) as { code: string; label: string | null }[]}
              editable={!it.deleted_at && !sold} />
            {!it.deleted_at && !sold && <p className="mt-2 text-xs text-muted">Cliquez sur une valeur pour la modifier. Chaque changement peut être annulé.</p>}
          </Card>
          {!it.deleted_at && !sold && <Card title="Actions"><ItemActions item={it} isManager={ctx.isManager} /></Card>}
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
                  <li key={l.id}>{l.channel} · {l.status} · {money(l.price_cents)} {l.url && <a className="-my-3 inline-block px-1 py-3 text-accent underline" href={l.url} target="_blank" rel="noreferrer">ouvrir</a>}</li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Historique">
            {timeline.length === 0 ? <p className="text-sm text-muted">Aucun événement.</p> : (
              <ol className="relative space-y-3 border-l border-line pl-4 text-sm">
                {timeline.map((t, i) => (
                  <li key={i} className="relative">
                    <span className={`absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-panel ${t.main ? "bg-accent" : "bg-muted/60"}`} />
                    <div className={t.main ? "font-medium" : "text-fg/80"}>{t.text}</div>
                    <div className="text-xs text-muted">{dateTime(t.at)}{t.who ? ` · ${t.who}` : ""}</div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between"><dt className="text-muted">{k}</dt><dd className="tabular-nums">{v}</dd></div>;
}

const BLOCK: Record<string, string> = {
  missing_photos: "photo manquante", missing_measurements: "mesures manquantes", defect_check: "défaut à vérifier",
  wrong_sku: "SKU incorrect", missing_info: "informations manquantes", quality: "problème qualité", other: "autre",
};
const PRIORITY = ["basse", "normale", "haute", "urgente"];

/** One line of history in plain French */
function describe(e: { type: string; from_status: string | null; to_status: string | null; payload: Record<string, unknown> | null }): string {
  const p = e.payload ?? {};
  const st = (s: string | null) => (s ? STATUS_LABEL[s as ItemStatus] ?? s : "");
  switch (e.type) {
    case "status": {
      const base = e.from_status ? `${st(e.from_status)} → ${st(e.to_status)}` : st(e.to_status);
      return [base, p.forced ? "(correction manuelle)" : "", p.reason ? `· ${String(p.reason)}` : ""].filter(Boolean).join(" ");
    }
    case "start": return "Tâche commencée";
    case "priority": return `Priorité ${PRIORITY[Number(p.from)] ?? "?"} → ${PRIORITY[Number(p.to)] ?? "?"}`;
    case "block": return `Bloqué : ${BLOCK[String(p.reason)] ?? "?"}${p.note ? ` — ${String(p.note)}` : ""}`;
    case "unblock": return "Blocage levé";
    case "assign": return p.to ? "Attribué à un employé" : "Attribution retirée";
    case "imported": return "Importé";
    case "deleted": return `Mis à la corbeille${p.reason ? ` · ${String(p.reason)}` : ""}`;
    case "restored": return "Restauré";
    case "sale_voided": return "Vente annulée";
    default: return e.type;
  }
}
