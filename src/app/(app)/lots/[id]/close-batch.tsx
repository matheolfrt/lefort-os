"use client";

import { useTransition } from "react";
import { btn } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { useToast } from "@/components/toast";
import { closeBatch } from "./actions";

export function CloseBatchButton({ batchId }: { batchId: string }) {
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const toast = useToast();
  return (
    <button
      className={btn.secondary}
      disabled={pending}
      onClick={async () => {
        const ok = await confirm({ title: "Clôturer le lot ?", confirmLabel: "Clôturer",
          message: "Les coûts des articles seront figés ; seules des corrections tracées resteront possibles." });
        if (!ok) return;
        start(async () => {
          const r = await closeBatch(batchId);
          if (r.error) toast(r.error, "error");
          else toast("Lot clôturé", "ok");
        });
      }}
    >
      Clôturer le lot
    </button>
  );
}
