"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Printer, RotateCcw, Trash2, X } from "lucide-react";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm";
import { StatusChip, btn, input } from "@/components/ui";
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
  { value: "listed", label: "Mettre en vente (en ligne), directement" },
  { value: "listing_ready", label: "Prêt à publier (retirer l'annonce)" },
  { value: "reserved", label: "Réservé" },
  { value: "on_hold", label: "En attente…" },
  { value: "release", label: "Reprendre (sortir de l'attente)" },
  { value: "rejected", label: "Écarté" },
  { value: "sorted", label: "Trié (refaire photos — responsable)" },
];

const SOLD: ItemStatus[] = ["sold", "shipped", "completed"];

// Items still on sale age; sold/discarded ones don't
const AGEING: ItemStatus[] = ["received", "sorted", "photographed", "measured", "listing_ready", "listed", "reserved", "on_hold", "returned"];

function Age({ row }: { row: StockRow }) {
  const d = daysSince(row.receivedAt);
  const ageing = AGEING.includes(row.status);
  const tone = !ageing ? "text-muted" : d > 90 ? "font-bold text-red-600 dark:text-red-400" : d > 60 ? "font-semibold text-amber-600 dark:text-amber-400" : "text-muted";
  return <span className={`tabular-nums ${tone}`}>{d} j</span>;
}

export function StockTable({ rows, categories, isManager = false, trash = false }: {
  rows: StockRow[]; categories: { id: string; name: string }[]; isManager?: boolean; trash?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [target, setTarget] = useState("");
  const [holdReason, setHoldReason] = useState<HoldReason>("cleaning");
  const [location, setLocation] = useState("");
  const [salePrice, setSalePrice] = useState("");
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
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)));

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
    if (target === "listed") {
      const cents = salePrice.trim() ? Math.round(Number(salePrice.replace(",", ".")) * 100) : null;
      if (cents != null && !(cents > 0)) return toast("Prix invalide", "error");
      return run("Mise en vente", () => rpc<BulkResult>("bulk_put_on_sale", { p_item_ids: ids, p_price_cents: cents }));
    }
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

  async function remove(list: StockRow[]) {
    const sold = list.filter((r) => SOLD.includes(r.status)).length;
    const n = list.length;
    const answer = await confirm({
      title: n === 1 ? `Supprimer ${list[0].sku} ?` : `Supprimer ${n} articles ?`,
      message: <>{n === 1 ? "Il ira" : "Ils iront"} dans la corbeille du stock, d&apos;où vous pourrez {n === 1 ? "le" : "les"} restaurer.</>,
      confirmLabel: "Supprimer",
      danger: true,
      reason: { label: "Motif", placeholder: "Doublon, erreur de saisie…", optional: true },
      checkbox: sold ? {
        label: n === 1 ? "Supprimer aussi sa vente" : `Supprimer aussi les ventes (${sold} article${sold > 1 ? "s" : ""} vendu${sold > 1 ? "s" : ""})`,
        hint: "La vente est annulée : elle sort des statistiques et du livre des recettes. Les autres articles d'un lot vendu ensemble reviennent « prêt à publier ».",
        required: sold === n,
      } : undefined,
    });
    if (!answer) return;
    run("Suppression", () => rpc<BulkResult>("delete_items", {
      p_item_ids: list.map((r) => r.id), p_reason: answer.reason || "Supprimé depuis le stock", p_with_sales: answer.checked,
    }));
  }
  const applyDelete = () => remove(rows.filter((r) => selected.has(r.id)));
  const restore = (list: string[]) => run("Restauration", () => rpc<BulkResult>("restore_items", { p_item_ids: list }));
  const applyRestore = () => restore(ids);

  /** One-tap action at the end of each row: delete (or restore in the trash) */
  const RowAction = ({ r }: { r: StockRow }) => !isManager ? null : trash ? (
    <button type="button" onClick={() => restore([r.id])} disabled={busy} aria-label={`Restaurer ${r.sku}`} title="Restaurer"
      className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-accent/15 hover:text-accent">
      <RotateCcw size={18} />
    </button>
  ) : (
    <button type="button" onClick={() => remove([r])} disabled={busy} aria-label={`Supprimer ${r.sku}`} title="Supprimer"
      className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted/70 transition hover:bg-red-500/15 hover:text-red-300">
      <Trash2 size={18} />
    </button>
  );

  const applyCategory = () => {
    if (!category) return;
    run("Catégorie", async () => {
      const { error } = await supabaseBrowser().from("items").update({ category_id: category }).in("id", ids);
      if (error) throw new Error(errorMessage(error));
      return { updated: ids.length, errors: [] };
    });
  };

  const Box = ({ checked, onClick, label }: { checked: boolean; onClick: (e: React.MouseEvent) => void; label: string }) => (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onClick}
      className="flex size-11 shrink-0 items-center justify-center rounded-lg"
    >
      <span className={`flex size-5 items-center justify-center rounded-[5px] border-2 transition ${
        checked ? "border-accent bg-accent text-accent-fg" : "border-fg/25 bg-panel"
      }`}>
        {checked && <Check size={14} strokeWidth={3} />}
      </span>
    </button>
  );

  return (
    <>
      {/* ── Phone: cards */}
      <div className="md:hidden">
        <div className="mb-1 flex items-center gap-1 text-sm text-muted">
          <Box checked={allChecked} onClick={toggleAll} label="Tout sélectionner" />
          <span>Tout sélectionner ({rows.length})</span>
        </div>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel/80">
          {rows.map((r, i) => (
            <li key={r.id} className={`flex items-center gap-1 ${isManager ? "pr-1" : "pr-3"} ${selected.has(r.id) ? "bg-accent/10" : ""}`}>
              <Box checked={selected.has(r.id)} onClick={() => toggle(i, false)} label={`Sélectionner ${r.sku}`} />
              <Link href={`/stock/${r.sku}`} className="min-w-0 flex-1 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-bold">{r.sku}</span>
                  <StatusChip status={r.status} />
                </div>
                <div className="truncate text-sm">{r.label || "—"}</div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                  {r.size && <span>T. {r.size}</span>}
                  {r.location && <span className="font-mono">{r.location.replace("EMP-", "")}</span>}
                  <span className="ml-auto font-semibold tabular-nums text-fg">{money(r.priceCents)}</span>
                  <Age row={r} />
                </div>
              </Link>
              <RowAction r={r} />
            </li>
          ))}
        </ul>
      </div>

      {/* ── Desktop: dense table */}
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-panel/80 md:block">
        <table className="data">
          <thead>
            <tr>
              <th className="w-12 !px-1"><Box checked={allChecked} onClick={toggleAll} label="Tout sélectionner" /></th>
              <th>SKU</th><th>Statut</th><th>Article</th><th>Taille</th><th>Emplacement</th><th className="num">Prix</th><th className="num">Âge</th>
              {isManager && <th className="w-12"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={selected.has(r.id) ? "!bg-accent/10" : ""}>
                <td className="!px-1 !py-0"><Box checked={selected.has(r.id)} onClick={(e) => toggle(i, e.shiftKey)} label={`Sélectionner ${r.sku}`} /></td>
                <td><Link href={`/stock/${r.sku}`} className="font-mono font-semibold text-fg hover:text-accent">{r.sku}</Link></td>
                <td><StatusChip status={r.status} /></td>
                <td className="max-w-96 truncate">{r.label}</td>
                <td>{r.size ?? "—"}</td>
                <td className="font-mono text-xs text-muted">{r.location?.replace("EMP-", "") ?? "—"}</td>
                <td className="num font-medium">{money(r.priceCents)}</td>
                <td className="num"><Age row={r} /></td>
                {isManager && <td className="!px-1 !py-0"><RowAction r={r} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {errors.length > 0 && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
          <div className="mb-1 font-semibold">Articles refusés (les autres ont été mis à jour) :</div>
          <ul className="space-y-0.5">
            {errors.map((e) => <li key={e.sku}><span className="font-mono font-semibold">{e.sku}</span> : {e.error}</li>)}
          </ul>
        </div>
      )}

      {ids.length > 0 && <div className="h-56 md:h-24" aria-hidden />}
      {ids.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 px-3 md:bottom-4 md:left-64 md:px-8">
          <div className="mx-auto grid max-w-6xl gap-2 rounded-2xl bg-ink p-3 text-ink-fg shadow-2xl ring-1 ring-line md:flex md:flex-wrap md:items-center">
            <div className="flex items-center gap-2">
              <span className="font-bold">{ids.length} sélectionné{ids.length > 1 ? "s" : ""}</span>
              <button className="flex size-9 items-center justify-center rounded-full opacity-70 hover:bg-white/10 hover:opacity-100"
                onClick={() => setSelected(new Set())} aria-label="Désélectionner"><X size={18} /></button>
              <a className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-md border border-white/20 px-3 text-sm font-medium md:ml-0"
                href={`/etiquettes/articles?skus=${skus.join(",")}`} target="_blank"><Printer size={16} /> Étiquettes</a>
            </div>

            {trash ? (
              <button className={btn.primary} disabled={busy} onClick={applyRestore}>Restaurer</button>
            ) : (<>
            <div className="flex items-center gap-1.5">
              <select className={`${input} min-w-0 flex-1 bg-panel text-fg md:w-auto md:flex-none`} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Nouveau statut">
                <option value="">Changer le statut…</option>
                {TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              {target === "listed" && (
                <input className={`${input} w-28 bg-panel text-fg`} inputMode="decimal" placeholder="Prix € (opt.)" value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)} aria-label="Prix de vente (facultatif)" />
              )}
              {target === "on_hold" && (
                <select className={`${input} w-auto bg-panel text-fg`} value={holdReason} onChange={(e) => setHoldReason(e.target.value as HoldReason)} aria-label="Motif">
                  {(Object.keys(HOLD_LABEL) as HoldReason[]).map((h) => <option key={h} value={h}>{HOLD_LABEL[h]}</option>)}
                </select>
              )}
              <button className={btn.primary} disabled={busy || !target} onClick={applyStatus}>Appliquer</button>
            </div>

            <div className="grid grid-cols-2 gap-1.5 md:flex md:items-center">
              <div className="flex gap-1.5">
                <input className={`${input} min-w-0 bg-panel font-mono uppercase text-fg md:w-36`} value={location} placeholder="Emplacement"
                  onChange={(e) => setLocation(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && applyLocation()} aria-label="Emplacement" />
                <button className="min-h-11 shrink-0 rounded-md bg-white/10 px-3 text-sm font-semibold hover:bg-white/20 disabled:opacity-40" disabled={busy || !location} onClick={applyLocation}>Déplacer</button>
              </div>
              <div className="flex gap-1.5">
                <select className={`${input} min-w-0 bg-panel text-fg md:w-auto`} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Catégorie">
                  <option value="">Catégorie…</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button className="min-h-11 shrink-0 rounded-md bg-white/10 px-3 text-sm font-semibold hover:bg-white/20 disabled:opacity-40" disabled={busy || !category} onClick={applyCategory}>OK</button>
              </div>
            </div>
            {isManager && (
              <button className="min-h-11 rounded-md px-3 text-sm font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-40 md:ml-auto"
                disabled={busy} onClick={applyDelete}>
                Supprimer
              </button>
            )}
            </>)}
          </div>
        </div>
      )}
    </>
  );
}
