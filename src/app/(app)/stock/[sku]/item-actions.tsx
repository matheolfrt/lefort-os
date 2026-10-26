"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useToast } from "@/components/toast";
import { btn } from "@/components/ui";
import { HOLD_LABEL } from "@/i18n/fr";
import { rpc } from "@/lib/client-data";
import type { HoldReason, Item } from "@/lib/types";

const PRE_SALE = ["received", "sorted", "photographed", "measured", "listing_ready", "returned"];

export function ItemActions({ item, isManager }: { item: Item; isManager: boolean }) {
  const router = useRouter();
  const toast = useToast();

  async function run(fn: string, args: Record<string, unknown>, ok: string) {
    try {
      await rpc(fn, args);
      toast(ok, "ok");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  const to = (status: string, payload: Record<string, unknown> = {}) =>
    run("transition_item", { p_item_id: item.id, p_to: status, p_expected_version: item.version, p_payload: payload }, "Statut mis à jour");

  return (
    <div className="grid gap-2">
      {item.status === "on_hold" && item.status_before_hold && (
        <button className={btn.primary} onClick={() => to(item.status_before_hold!)}>Reprendre le traitement</button>
      )}
      {PRE_SALE.includes(item.status) && (
        <details>
          <summary className={`${btn.secondary} w-full cursor-pointer list-none`}>Mettre en attente…</summary>
          <div className="mt-2 grid gap-1">
            {(Object.keys(HOLD_LABEL) as HoldReason[]).map((r) => (
              <button key={r} className={btn.secondary} onClick={() => to("on_hold", { hold_reason: r })}>{HOLD_LABEL[r]}</button>
            ))}
          </div>
        </details>
      )}
      {item.status === "listed" && (
        <>
          <button className={btn.secondary} onClick={() => to("reserved")}>Marquer réservé</button>
          <button className={btn.secondary} onClick={() => run("unpublish_item", { p_item_id: item.id }, "Annonce retirée")}>Retirer l&apos;annonce</button>
        </>
      )}
      {item.status === "reserved" && <button className={btn.secondary} onClick={() => to("listed")}>Annuler la réservation</button>}
      {(PRE_SALE.includes(item.status) || item.status === "on_hold") && (
        <button className={btn.danger} onClick={() => {
          const reason = prompt("Motif (invendable, trop abîmé…) ?");
          if (reason) to("rejected", { reason });
        }}>Écarter</button>
      )}
      {isManager && item.status === "rejected" && <button className={btn.secondary} onClick={() => to("sorted")}>Annuler l&apos;écart</button>}
      {isManager && ["photographed", "measured"].includes(item.status) && (
        <button className={btn.secondary} onClick={() => to("sorted")}>Correction : refaire les photos</button>
      )}
      {isManager && (
        <button
          className="mt-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-red-300 px-4 font-medium text-red-700 hover:bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10"
          onClick={async () => {
            const reason = prompt("Supprimer cet article ? Il ira dans la corbeille (restaurable).\nMotif (facultatif) :");
            if (reason === null) return;
            try {
              const r = await rpc<{ updated: number; errors: { error: string }[] }>("delete_items", { p_item_ids: [item.id], p_reason: reason });
              if (r.errors.length) return toast(r.errors[0].error, "error");
              toast(`${item.sku} supprimé`, "ok");
              router.push("/stock");
              router.refresh();
            } catch (e) {
              toast((e as Error).message, "error");
            }
          }}
        >
          <Trash2 size={16} /> Supprimer l&apos;article
        </button>
      )}
    </div>
  );
}

/** Shown on the page of a deleted item */
export function RestoreItem({ itemId, sku, isManager }: { itemId: string; sku: string; isManager: boolean }) {
  const router = useRouter();
  const toast = useToast();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-red-50 p-3 text-red-900 dark:bg-red-500/10 dark:text-red-200">
      <Trash2 size={18} />
      <span className="flex-1 font-semibold">Article supprimé : il n&apos;apparaît plus dans le stock ni dans les statistiques.</span>
      {isManager && (
        <button className={btn.secondary} onClick={async () => {
          try {
            await rpc("restore_items", { p_item_ids: [itemId] });
            toast(`${sku} restauré`, "ok");
            router.refresh();
          } catch (e) {
            toast((e as Error).message, "error");
          }
        }}>Restaurer</button>
      )}
    </div>
  );
}
