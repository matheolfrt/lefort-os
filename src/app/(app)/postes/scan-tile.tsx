"use client";

import { ScanLine } from "lucide-react";
import { useScanApi } from "@/components/scan-provider";

export function StationScanTile() {
  const { openQuick } = useScanApi();
  return (
    <button onClick={openQuick}
      className="flex min-h-24 items-center gap-4 rounded-xl border border-dashed border-line bg-panel p-4 text-left transition hover:border-fg/30 active:scale-[0.99]">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-bg text-fg/70"><ScanLine size={22} /></span>
      <span>
        <span className="block font-bold">Scanner un SKU</span>
        <span className="block text-sm text-muted">Ouvrir n&apos;importe quel article · ⌘K</span>
      </span>
    </button>
  );
}
