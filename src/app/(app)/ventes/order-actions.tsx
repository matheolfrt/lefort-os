"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { btn, input } from "@/components/ui";
import { rpc } from "@/lib/client-data";
import { parseEuros } from "@/lib/format";

/** `compact` (sales table): one "⋯" button opening the actions, so rows stay one line high */
export function OrderActions({ orderId, status, items, compact = false }: {
  orderId: string; status: string; items: { id: string; sku: string }[]; compact?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [panel, setPanel] = useState<"complete" | "refund" | null>(null);
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("Rétractation");
  const [returned, setReturned] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  // the menu is placed over the page (fixed), so the scrolling table neither clips it nor scrolls to it
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const place = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
  };

  // the menu closes on a click elsewhere or Escape
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) { setOpen(false); setPanel(null); } };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setPanel(null); } };
    // the menu follows its button when the page or the table scrolls
    const follow = () => place();
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", follow, true); window.removeEventListener("resize", follow);
    };
  }, [open]);

  async function run(fn: string, args: Record<string, unknown>, ok: string) {
    try {
      await rpc(fn, args);
      toast(ok, "ok");
      setPanel(null);
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  if (status === "cancelled") return null;
  const content = (
    <div className={compact ? "flex flex-col gap-1.5 text-sm" : "flex flex-col items-end gap-1.5 text-sm"}>
      <div className="flex flex-wrap justify-end gap-1.5">
      {status === "pending" && (
        <button className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-sm font-medium hover:border-fg/30 text-red-700 dark:text-red-400" onClick={async () => {
          const a = await confirm({ title: "Annuler la commande ?", message: "Les articles sont remis en vente.", danger: true,
            confirmLabel: "Annuler la commande", reason: { label: "Motif", placeholder: "Acheteur injoignable…" } });
          if (a) run("cancel_order", { p_order_id: orderId, p_reason: a.reason }, "Commande annulée, articles remis en vente");
        }}>Annuler</button>
      )}
      {status === "shipped" && <button className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-sm font-medium hover:border-fg/30" onClick={() => setPanel(panel === "complete" ? null : "complete")}>Clôturer</button>}
      {status !== "cancelled" && (
        <button aria-label="Supprimer la vente" title="Supprimer la vente (erreur, doublon)"
          className="inline-flex size-10 items-center justify-center rounded-lg border border-line text-muted/80 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
          onClick={async () => {
            const a = await confirm({
              title: "Supprimer cette vente ?", danger: true, confirmLabel: "Supprimer la vente",
              message: "Pour une vente saisie par erreur ou importée en double. Elle sort des statistiques et du livre des recettes ; ses articles reviennent « prêt à publier ».",
              reason: { label: "Motif", placeholder: "Doublon, mauvais article…", optional: true },
            });
            if (a) run("void_order", { p_order_id: orderId, p_reason: a.reason || null }, "Vente supprimée, articles remis en stock");
          }}><Trash2 size={16} /></button>
      )}
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

  if (!compact) return content;
  return (
    <div ref={box} className="relative flex justify-end">
      <button ref={trigger} type="button" aria-label="Actions de la vente" aria-expanded={open}
        onClick={() => { place(); setOpen((o) => !o); setPanel(null); }}
        className={`inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-fg/5 hover:text-fg ${open ? "bg-fg/5 text-fg" : ""}`}>
        <MoreHorizontal size={18} />
      </button>
      {open && pos && (
        <div className="pop-in fixed z-50 w-72 rounded-2xl border border-line bg-panel p-2.5 shadow-2xl" style={{ top: pos.top, right: pos.right }}>
          {content}
        </div>
      )}
    </div>
  );
}
