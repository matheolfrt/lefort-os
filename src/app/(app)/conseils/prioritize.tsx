"use client";

import { useState } from "react";
import { Check, Flag } from "lucide-react";
import { useToast } from "@/components/toast";
import { rpc } from "@/lib/client-data";

/** Raises the advised items to high priority: they come first in Production and in "Prochaine tâche" */
export function Prioritize({ ids }: { ids: string[] }) {
  const toast = useToast();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  return (
    <button type="button" disabled={state !== "idle"}
      onClick={async () => {
        setState("busy");
        try {
          const r = await rpc<{ updated: number }>("set_item_priority", { p_item_ids: ids, p_priority: 2 });
          toast(`${r.updated} article${r.updated > 1 ? "s" : ""} en priorité haute dans Production`, "ok");
          setState("done");
        } catch (e) {
          toast((e as Error).message, "error");
          setState("idle");
        }
      }}
      className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-accent/15 px-3 text-sm font-semibold text-accent ring-1 ring-inset ring-accent/30 hover:bg-accent/25 disabled:opacity-70">
      {state === "done" ? <><Check size={15} /> Priorisés</> : <><Flag size={15} /> Prioriser dans Production</>}
    </button>
  );
}
