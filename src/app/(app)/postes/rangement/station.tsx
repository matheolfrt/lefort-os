"use client";

import { useState } from "react";
import { useScan, useScanApi } from "@/components/scan-provider";
import { StationHeader } from "@/components/station-header";
import { useToast } from "@/components/toast";
import { btn, input } from "@/components/ui";
import { asItem, rpc } from "@/lib/client-data";
import type { Item } from "@/lib/types";

interface MoveResult { location_code: string; promoted: boolean; pending_reason: string | null; occupancy: number; capacity: number | null }
interface QueueItem { id: string; sku: string; label: string }

/**
 * Two scans, zero clicks: scan the item, then the bin.
 * Scanning a bin first switches to "fill" mode: every following item goes into that bin.
 */
export function StorageStation({ initialQueue }: { initialQueue: QueueItem[] }) {
  const toast = useToast();
  const { dispatch, openCamera } = useScanApi();
  const [queue, setQueue] = useState(initialQueue);
  const [pending, setPending] = useState<Item | null>(null);
  const [bin, setBin] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [log, setLog] = useState<string[]>([]);

  async function move(item: Item, code: string) {
    try {
      const r = await rpc<MoveResult>("move_item", { p_item_id: item.id, p_location_code: code });
      const where = r.location_code.replace("EMP-", "");
      const full = r.capacity && r.occupancy > r.capacity ? ` ⚠ plein (${r.occupancy}/${r.capacity})` : "";
      toast(`${item.sku} → ${where}${r.promoted ? " · prêt à publier" : ""}${full}`, r.pending_reason && !r.promoted ? "info" : "ok");
      if (r.pending_reason && !r.promoted && item.status === "measured") toast(r.pending_reason, "error");
      setLog((l) => [`${item.sku} → ${where}`, ...l].slice(0, 30));
      setQueue((q) => q.filter((x) => x.id !== item.id));
      setPending(null);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  useScan(async (scan) => {
    if (scan.kind === "item") {
      const item = asItem(await rpc<Item>("find_item_by_sku", { p_sku: scan.code }).catch(() => null));
      if (!item) {
        toast(`${scan.code} introuvable`, "error");
        return true;
      }
      if (bin) await move(item, bin);
      else setPending(item);
      return true;
    }
    if (scan.kind === "location") {
      if (pending) await move(pending, scan.code);
      else {
        setBin(scan.code);
        toast(`Mode remplissage : ${scan.code.replace("EMP-", "")}`, "info");
      }
      return true;
    }
    return false;
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <StationHeader title="Rangement" queue={queue.length} done={log.length} />

      <div aria-live="polite" className={`flex min-h-40 flex-col items-center justify-center rounded-2xl p-6 text-center ${pending ? "bg-accent text-accent-fg" : bin ? "bg-emerald-700 text-white" : "bg-panel-2 text-fg ring-1 ring-inset ring-line"}`}>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] opacity-70">
          {pending ? "Étape 2 / 2" : bin ? "Mode remplissage" : "Étape 1 / 2"}
        </div>
        {pending ? (
          <>
            <div className="font-mono text-3xl font-black">{pending.sku}</div>
            <div className="mt-2 text-xl">→ Scannez l&apos;emplacement</div>
          </>
        ) : bin ? (
          <>
            <div className="font-mono text-3xl font-black">{bin.replace("EMP-", "")}</div>
            <div className="mt-2 text-xl">Scannez les articles à y ranger</div>
          </>
        ) : (
          <>
            <div className="text-2xl font-bold">Scannez un article</div>
            <div className="mt-1 text-sm opacity-70">ou un emplacement pour y ranger plusieurs articles d&apos;affilée</div>
          </>
        )}
      </div>

      <div className="flex gap-2">
        <input
          aria-label="Saisie manuelle d'un code"
          className={`${input} font-mono uppercase`}
          value={manual}
          placeholder="Saisie manuelle : LSH00001 ou EMP-A-01-02"
          onChange={(e) => setManual(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter" && manual) {
              dispatch(manual);
              setManual("");
            }
          }}
        />
        <button className={`${btn.primary} shrink-0 md:hidden`} onClick={openCamera}>Scanner</button>
      </div>
      {(pending || bin) && (
        <button className={`${btn.secondary} w-full`} onClick={() => { setPending(null); setBin(null); }}>Terminer / annuler</button>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-line bg-panel/80 p-3">
          <h2 className="mb-2 eyebrow text-muted">À ranger · {queue.length}</h2>
          {queue.length === 0 ? <p className="text-sm text-muted">Rien à ranger.</p> : (
            <ul className="max-h-80 divide-y divide-line overflow-auto text-sm">
              {queue.map((q) => (
                <li key={q.id} className="flex min-h-10 items-center gap-2">
                  <span className="font-mono font-semibold">{q.sku}</span>
                  <span className="truncate text-muted">{q.label}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-2xl border border-line bg-panel/80 p-3">
          <h2 className="mb-2 eyebrow text-muted">Rangés cette session · {log.length}</h2>
          {log.length === 0 ? <p className="text-sm text-muted">Rien pour l&apos;instant.</p> : (
            <ul className="divide-y divide-line font-mono text-sm">{log.map((l, i) => <li key={i} className="flex min-h-10 items-center">{l}</li>)}</ul>
          )}
        </section>
      </div>
    </div>
  );
}
