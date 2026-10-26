"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useToast } from "@/components/toast";
import { SkuLink, StatusChip, btn, input } from "@/components/ui";
import { HOLD_LABEL } from "@/i18n/fr";
import { daysSince, money } from "@/lib/format";
import { rpc } from "@/lib/client-data";
import { supabaseBrowser } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";
import type { HoldReason, ItemStatus } from "@/lib/types";

export interface StockRow {
  id: string;
  sku: string;
  status: ItemStatus;
  onHold: boolean;
  label: string;
  size: string | null;
  location: string | null;
  priceCents: number | null;
  receivedAt: string;
}

interface BulkResult { updated: number; errors: { sku: string; error: string }[] }

// Statuses a person may set by hand; sold/shipped/completed/returned are handled in Ventes
const TARGETS: { value: string; label: string }[] = [
  { value: "listing_ready", label: "Prêt à publier (retirer l'annonce)" },
  { value: "listed", label: "En ligne" },
  { value: "reserved", label: "Réservé" },
  { value: "on_hold", label: "En attente…" },
  { value: "release", label: "Reprendre (sortir de l'attente)" },
  { value: "rejected", label: "Écarté" },
  { value: "sorted", label: "Trié (refaire photos — responsable)" },
];

export function StockTable({ rows, categories }: { rows: StockRow[]; categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [target, setTarget] = useState("");
  const [holdReason, setHoldReason] = useState<HoldReason>("cleaning");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<BulkResult["errors"]>([]);

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const ids = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const skus = rows.filter((r) => selected.has(r.id)).map((r) => r.sku);

  function toggle(index: number, shift: boolean) {
    setSelected((cur) => {
      const next = new Set(cur);
      const on = !cur.has(rows[index].id);
      // Shift+click selects the whole range since the last clicked row
      const [from, to] = shift && anchor !== null ? [Math.min(anchor, index), Math.max(anchor, index)] : [index, index];
      for (let i = from; i <= to; i++) {
        if (on) next.add(rows[i].id);
        else next.delete(rows[i].id);
      }
      return next;
    });
    setAnchor(index);
  }

  async function run(label: string, action: () => Promise<BulkResult>) {
    setBusy(true);
    setErrors([]);
    try {
      const r = await action();
      setErrors(r.errors);
      toast(`${label} : ${r.updated} article${r.updated > 1 ? "s" : ""} mis à jour${r.errors.length ? `, ${r.errors.length} refusé(s)` : ""}`,
        r.errors.length ? "error" : "ok");
      if (!r.errors.length) setSelected(new Set());
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const applyStatus = () => {
    if (!target) return;
    run("Statut", () =>
      rpc<BulkResult>("bulk_transition", {
        p_item_ids: ids,
        p_to: target === "release" ? null : target,
        p_payload: target === "on_hold" ? { hold_reason: holdReason } : target === "rejected" ? { reason: "Écarté depuis le stock" } : {},
      }),
    );
  };

  const applyLocation = () => {
    if (!location.trim()) return;
    run("Emplacement", () => rpc<BulkResult>("bulk_move", { p_item_ids: ids, p_location_code: location }));
  };

  const applyCategory = () => {
    if (!category) return;
    run("Catégorie", async () => {
      const { error } = await supabaseBrowser().from("items").update({ category_id: category }).in("id", ids);
      if (error) throw new Error(errorMessage(error));
      return { updated: ids.length, errors: [] };
    });
  };

  return (
    <>
      <div className="overflow-x-auto">
        <table className="data">
          <thead>
            <tr>
              <th className="w-8">
                <input
                  type="checkbox"
                  aria-label="Tout sélectionner"
                  className="size-4 accent-[var(--accent)]"
                  checked={allChecked}
                  onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              </th>
              <th>SKU</th><th>Statut</th><th>Article</th><th>Taille</th><th>Emplacement</th><th className="num">Prix</th><th className="num">Âge</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={selected.has(r.id) ? "bg-accent/10" : ""}>
                <td onClick={(e) => { if (e.target === e.currentTarget) toggle(i, e.shiftKey); }}>
                  <input
                    type="checkbox"
                    aria-label={`Sélectionner ${r.sku}`}
                    className="size-4 accent-[var(--accent)]"
                    checked={selected.has(r.id)}
                    onChange={() => {}}
                    onClick={(e) => toggle(i, e.shiftKey)}
                  />
                </td>
                <td><SkuLink sku={r.sku} /></td>
                <td><StatusChip status={r.status} /></td>
                <td className="max-w-80 truncate">{r.label}</td>
                <td>{r.size ?? "—"}</td>
                <td className="font-mono text-xs">{r.location?.replace("EMP-", "") ?? "—"}</td>
                <td className="num">{money(r.priceCents)}</td>
                <td className="num">{daysSince(r.receivedAt)} j</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {errors.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <div className="mb-1 font-semibold">Articles refusés (les autres ont été mis à jour) :</div>
          <ul className="space-y-0.5">
            {errors.map((e) => <li key={e.sku}><span className="font-mono font-semibold">{e.sku}</span> : {e.error}</li>)}
          </ul>
        </div>
      )}

      {ids.length > 0 && <div className="h-24" aria-hidden />}
      {ids.length > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-30 px-3 md:bottom-4 md:left-60 md:px-8">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 rounded-xl bg-ink p-3 text-ink-fg shadow-2xl">
            <span className="px-1 font-bold">{ids.length} sélectionné{ids.length > 1 ? "s" : ""}</span>
            <button className="rounded p-1 opacity-70 hover:opacity-100" onClick={() => setSelected(new Set())} aria-label="Désélectionner"><X size={18} /></button>

            <div className="flex items-center gap-1">
              <select className={`${input} w-auto bg-panel text-fg`} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Nouveau statut">
                <option value="">Changer le statut…</option>
                {TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              {target === "on_hold" && (
                <select className={`${input} w-auto bg-panel text-fg`} value={holdReason} onChange={(e) => setHoldReason(e.target.value as HoldReason)} aria-label="Motif">
                  {(Object.keys(HOLD_LABEL) as HoldReason[]).map((h) => <option key={h} value={h}>{HOLD_LABEL[h]}</option>)}
                </select>
              )}
              <button className={btn.primary} disabled={busy || !target} onClick={applyStatus}>Appliquer</button>
            </div>

            <div className="flex items-center gap-1">
              <input className={`${input} w-36 bg-panel font-mono uppercase text-fg`} value={location} placeholder="EMP-A-01-02"
                onChange={(e) => setLocation(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && applyLocation()} aria-label="Emplacement" />
              <button className={btn.secondary + " text-fg"} disabled={busy || !location} onClick={applyLocation}>Déplacer</button>
            </div>

            <div className="flex items-center gap-1">
              <select className={`${input} w-auto bg-panel text-fg`} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Catégorie">
                <option value="">Catégorie…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button className={btn.secondary + " text-fg"} disabled={busy || !category} onClick={applyCategory}>OK</button>
            </div>

            <a className={btn.secondary + " text-fg"} href={`/etiquettes/articles?skus=${skus.join(",")}`} target="_blank">Étiquettes</a>
          </div>
        </div>
      )}
    </>
  );
}
