"use client";

import { useRouter } from "next/navigation";
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
    </div>
  );
}
