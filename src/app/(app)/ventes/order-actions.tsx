"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { btn, input } from "@/components/ui";
import { rpc } from "@/lib/client-data";
import { parseEuros } from "@/lib/format";

export function OrderActions({ orderId, status, items }: { orderId: string; status: string; items: { id: string; sku: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [panel, setPanel] = useState<"complete" | "refund" | null>(null);
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("Rétractation");
  const [returned, setReturned] = useState<string[]>([]);

  async function run(fn: string, args: Record<string, unknown>, ok: string) {
    try {
      await rpc(fn, args);
      toast(ok, "ok");
      setPanel(null);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5 text-sm">
      <div className="flex flex-wrap justify-end gap-1.5">
      {status === "pending" && (
        <button className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-sm font-medium hover:border-fg/30 text-red-700 dark:text-red-400" onClick={() => {
          const why = prompt("Motif d'annulation ?");
          if (why) run("cancel_order", { p_order_id: orderId, p_reason: why }, "Commande annulée, articles remis en vente");
        }}>Annuler</button>
      )}
      {status === "shipped" && <button className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-sm font-medium hover:border-fg/30" onClick={() => setPanel(panel === "complete" ? null : "complete")}>Clôturer</button>}
      {(status === "shipped" || status === "completed") && <button className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-sm font-medium hover:border-fg/30" onClick={() => setPanel(panel === "refund" ? null : "refund")}>Rembourser</button>}
      </div>

      {panel === "complete" && (
        <div className="w-64 space-y-2 rounded-2xl border border-line bg-panel/80 p-3 shadow-lg">
          <label className="block text-xs">Date d&apos;encaissement (argent disponible)</label>
          <input type="date" className={input} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          <button className={`${btn.primary} w-full`} onClick={() => run("complete_order", { p_order_id: orderId, p_paid_at: new Date(paidAt + "T12:00:00").toISOString() }, "Commande clôturée")}>Valider</button>
        </div>
      )}
      {panel === "refund" && (
        <div className="w-64 space-y-2 rounded-2xl border border-line bg-panel/80 p-3 shadow-lg">
          <input className={input} inputMode="decimal" placeholder="Montant remboursé €" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} />
          {items.map((i) => (
            <label key={i.id} className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" checked={returned.includes(i.id)} onChange={(e) => setReturned((r) => (e.target.checked ? [...r, i.id] : r.filter((x) => x !== i.id)))} />
              {i.sku} retourné
            </label>
          ))}
          <button className={`${btn.danger} w-full`} onClick={() => {
            const cents = parseEuros(amount);
            if (cents == null) return toast("Montant invalide", "error");
            run("record_refund", { p_order_id: orderId, p_amount_cents: cents, p_reason: reason, p_returned_item_ids: returned }, "Remboursement enregistré");
          }}>Enregistrer</button>
        </div>
      )}
    </div>
  );
}
