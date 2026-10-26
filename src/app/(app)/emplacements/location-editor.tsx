"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm";
import { btn, input } from "@/components/ui";
import { rpc } from "@/lib/client-data";

/** Rename (the name becomes the label code: EMP-PORTANT-HIVER), describe, set capacity or remove a storage location */
export function LocationEditor({ loc, count }: {
  loc: { id: string; code: string; label: string | null; capacity: number | null }; count: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(loc.code.replace(/^EMP-/, ""));
  const [label, setLabel] = useState(loc.label ?? "");
  const [capacity, setCapacity] = useState(loc.capacity ? String(loc.capacity) : "");
  const [busy, setBusy] = useState(false);
  const preview = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  async function save() {
    setBusy(true);
    try {
      const r = await rpc<{ code: string }>("save_location", {
        p_id: loc.id, p_name: name, p_label: label || null, p_capacity: capacity ? Number(capacity) : null,
      });
      toast(r.code !== loc.code ? "Emplacement renommé : réimprimez son étiquette" : "Emplacement enregistré", "ok");
      setOpen(false);
      router.replace(`/emplacements/${r.code}`);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    const ok = await confirm({ title: `Supprimer ${preview} ?`, danger: true, confirmLabel: "Supprimer",
      message: "L'emplacement disparaît des listes. Il doit être vide." });
    if (!ok) return;
    try {
      await rpc("archive_location", { p_id: loc.id });
      toast("Emplacement supprimé", "ok");
      router.push("/emplacements");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  if (!open) {
    return <button className={btn.secondary} onClick={() => setOpen(true)}><Pencil size={16} /> Renommer / modifier</button>;
  }
  return (
    <form className="w-full space-y-3 rounded-2xl border border-line bg-panel/80 p-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <label className="block">
        <span className="eyebrow-tight mb-1.5 block text-muted">Nom</span>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Portant hiver, Carton 3, Étagère du haut…" required autoFocus />
        <span className="mt-1 block text-xs text-muted">Affiché partout et sur l&apos;étiquette : <span className="font-mono text-fg">{preview || "—"}</span></span>
      </label>
      <label className="block">
        <span className="eyebrow-tight mb-1.5 block text-muted">Description (facultatif)</span>
        <input className={input} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Près de la fenêtre…" />
      </label>
      <label className="block">
        <span className="eyebrow-tight mb-1.5 block text-muted">Capacité (facultatif)</span>
        <input className={input} type="number" min={1} inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="articles" />
      </label>
      {preview !== loc.code.replace(/^EMP-/, "") && (
        <p className="text-xs text-highlight">Le code de l&apos;étiquette change : pensez à la réimprimer et à la recoller.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button className={btn.primary} disabled={busy || !preview}>Enregistrer</button>
        <button type="button" className={btn.secondary} onClick={() => setOpen(false)}>Annuler</button>
        <button type="button" className="ml-auto inline-flex min-h-11 items-center gap-2 px-2 text-sm text-red-300 hover:underline disabled:opacity-40"
          onClick={remove} disabled={count > 0} title={count > 0 ? "Videz d'abord l'emplacement" : undefined}>
          <Trash2 size={16} /> Supprimer
        </button>
      </div>
    </form>
  );
}
