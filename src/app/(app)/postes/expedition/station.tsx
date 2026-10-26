"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { useScan } from "@/components/scan-provider";
import { StationHeader } from "@/components/station-header";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm";
import { Empty, btn, input } from "@/components/ui";
import { dateTime, daysSince } from "@/lib/format";
import { rpc } from "@/lib/client-data";

interface Row {
  order_id: string; order_number: number; channel: string; buyer_handle: string | null; sold_at: string;
  item_id: string; sku: string; title: string | null; size_label: string | null; location_code: string | null;
}
const CARRIERS = ["Mondial Relay", "Vinted Go", "Relais Colis", "Colissimo", "Chronopost", "UPS", "Remise en main propre"];

/** Pick list sorted by location, scan-to-confirm each item, then mark the parcel shipped. */
export function ShippingStation() {
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [carrier, setCarrier] = useState(CARRIERS[0]);
  const [tracking, setTracking] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await rpc<Row[]>("shipping_queue", {}));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const orders = useMemo(() => {
    const m = new Map<string, Row[]>();
    rows.forEach((r) => m.set(r.order_id, [...(m.get(r.order_id) ?? []), r]));
    return [...m.values()];
  }, [rows]);

  useScan((scan) => {
    if (scan.kind === "item") {
      const row = rows.find((r) => r.sku === scan.code);
      // a carrier number can look like a SKU (MR12345678): with an order open, it is the tracking number
      if (!row && active) {
        setTracking(scan.code);
        return true;
      }
      if (!row) {
        toast(`${scan.code} n'est dans aucune commande à expédier`, "error");
        return true;
      }
      setPicked((p) => new Set(p).add(row.item_id));
      setActive(row.order_id);
      toast(`${row.sku} prélevé`, "ok");
      return true;
    }
    // any other barcode while an order is open = carrier tracking number
    if (active && scan.kind === "unknown") {
      setTracking(scan.code);
      return true;
    }
    return false;
  });

  async function ship(orderId: string) {
    const lines = rows.filter((r) => r.order_id === orderId);
    if (lines.some((l) => !picked.has(l.item_id)) && !(await confirm({ title: "Expédier quand même ?",
      message: "Tous les articles de la commande n'ont pas été scannés.", confirmLabel: "Expédier" }))) return;
    setBusy(true);
    try {
      await rpc("ship_order", { p_order_id: orderId, p_carrier: carrier, p_tracking: tracking || null });
      toast(`Commande V-${lines[0].order_number} expédiée`, "ok");
      setTracking("");
      setActive(null);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <StationHeader title="Expédition" queue={orders.length} />
      {orders.length === 0 ? (
        <Empty>Rien à expédier.</Empty>
      ) : (
        orders.map((lines) => {
          const o = lines[0];
          const isActive = active === o.order_id;
          const late = daysSince(o.sold_at) >= 1;
          const pickedCount = lines.filter((l) => picked.has(l.item_id)).length;
          return (
            <section key={o.order_id} className={`overflow-hidden rounded-xl border-2 bg-panel ${isActive ? "border-ink" : "border-line"}`}>
              <button
                type="button"
                aria-expanded={isActive}
                onClick={() => setActive(isActive ? null : o.order_id)}
                className="flex min-h-14 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-left"
              >
                <span className="font-bold">V-{o.order_number} <span className="font-normal text-muted">· {o.buyer_handle ?? "acheteur"}</span></span>
                <span className="flex items-center gap-2 text-sm">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pickedCount === lines.length ? "bg-emerald-600 text-white" : "bg-line/70 text-muted"}`}>
                    {pickedCount}/{lines.length} prélevé{lines.length > 1 ? "s" : ""}
                  </span>
                  <span className={late ? "font-semibold text-red-600 dark:text-red-400" : "text-muted"}>
                    {late ? `en retard · ` : ""}vendu {dateTime(o.sold_at)}
                  </span>
                </span>
              </button>
              <ul className="divide-y divide-line border-t border-line">
                {lines.map((l) => (
                  <li key={l.item_id} className="flex min-h-14 items-center gap-3 px-4 py-2">
                    {picked.has(l.item_id) ? <CheckCircle2 className="shrink-0 text-emerald-600" aria-label="prélevé" /> : <Circle className="shrink-0 text-muted" aria-label="à prélever" />}
                    <span className="shrink-0 rounded-md bg-fg px-2 py-1 font-mono text-sm font-bold text-bg">{l.location_code?.replace("EMP-", "") ?? "?"}</span>
                    <span className="min-w-0">
                      <span className="block font-mono text-sm font-semibold">{l.sku}</span>
                      <span className="block truncate text-xs text-muted">{l.title ?? (l.size_label ? `T${l.size_label}` : "")}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {isActive && (
                <div className="grid gap-2 border-t border-line bg-bg/60 p-4 sm:grid-cols-[180px_1fr]">
                  <p className="text-xs text-muted sm:col-span-2">Scannez chaque article pour confirmer le prélèvement, puis le bordereau pour le numéro de suivi.</p>
                  <select className={input} value={carrier} onChange={(e) => setCarrier(e.target.value)} aria-label="Transporteur">
                    {CARRIERS.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <input className={input} value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="N° de suivi (scannez le bordereau)" aria-label="Numéro de suivi" />
                  <button className={`${btn.huge} sm:col-span-2`} disabled={busy} onClick={() => ship(o.order_id)}>
                    Colis expédié
                  </button>
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
