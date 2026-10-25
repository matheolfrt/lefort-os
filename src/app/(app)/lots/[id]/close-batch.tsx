"use client";

import { useTransition } from "react";
import { btn } from "@/components/ui";
import { closeBatch } from "./actions";

export function CloseBatchButton({ batchId }: { batchId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      className={btn.secondary}
      disabled={pending}
      onClick={() => {
        if (!confirm("Clôturer le lot ? Les coûts des articles seront figés ; seules des corrections tracées resteront possibles.")) return;
        start(async () => {
          const r = await closeBatch(batchId);
          if (r.error) alert(r.error);
        });
      }}
    >
      Clôturer le lot
    </button>
  );
}
