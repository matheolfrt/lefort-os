"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { useScan } from "@/components/scan-provider";
import { useToast } from "@/components/toast";
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
    if (lines.some((l) => !picked.has(l.item_id)) && !confirm("Tous les articles n'ont pas été scannés. Expédier quand même ?")) return;
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
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-bold">Expédition</h1>
      {orders.length === 0 ? (
        <Empty>Rien à expédier. 🎉</Empty>
      ) : (
        orders.map((lines) => {
          const o = lines[0];
          const isActive = active === o.order_id;
          const late = daysSince(o.sold_at) >= 1;
          return (
            <section key={o.order_id} className={`rounded-xl border-2 bg-panel p-4 ${isActive ? "border-accent" : "border-line"}`} onClick={() => setActive(o.order_id)}>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-bold">V-{o.order_number} · {o.buyer_handle ?? "acheteur"}</div>
                <div className={`text-sm ${late ? "font-semibold text-red-600" : "text-muted"}`}>vendu {dateTime(o.sold_at)}</div>
              </div>
              <ul className="space-y-2">
                {lines.map((l) => (
                  <li key={l.item_id} className="flex items-center gap-3">
                    {picked.has(l.item_id) ? <CheckCircle2 className="text-emerald-600" /> : <Circle className="text-muted" />}
                    <span className="rounded bg-ink px-2 py-1 font-mono text-sm font-bold text-ink-fg">{l.location_code?.replace("EMP-", "") ?? "?"}</span>
                    <span className="font-mono font-semibold">{l.sku}</span>
                    <span className="truncate text-sm text-muted">{l.title ?? ""} {l.size_label && `T${l.size_label}`}</span>
                  </li>
                ))}
              </ul>
              {isActive && (
                <div className="mt-4 grid gap-2 sm:grid-cols-[180px_1fr]">
                  <select className={input} value={carrier} onChange={(e) => setCarrier(e.target.value)}>
                    {CARRIERS.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <input className={input} value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="N° de suivi (scannez le bordereau)" />
                  <button className={`${btn.huge} sm:col-span-2`} disabled={busy} onClick={(e) => { e.stopPropagation(); ship(o.order_id); }}>
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
