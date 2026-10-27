"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopySql({ sql }: { sql: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  return (
    <div className="flex items-center gap-2">
      <button type="button"
        onClick={async () => {
          try { await navigator.clipboard.writeText(sql); setState("copied"); setTimeout(() => setState("idle"), 2500); }
          catch { setState("manual"); }
        }}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line bg-panel-2 px-3 text-sm font-medium hover:border-fg/30">
        {state === "copied" ? <><Check size={15} className="text-accent" /> Copié</> : <><Copy size={15} /> Copier le SQL</>}
      </button>
      {state === "manual" && (
        // the browser refused the clipboard: the text is shown selected, ready for ⌘C
        <textarea readOnly autoFocus value={sql} onFocus={(e) => e.currentTarget.select()} aria-label="SQL à copier"
          className="h-24 w-64 rounded-lg border border-line bg-bg p-2 font-mono text-[11px]" />
      )}
    </div>
  );
}
