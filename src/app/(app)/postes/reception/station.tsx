"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BrandPicker } from "@/components/brand-picker";
import { useScan } from "@/components/scan-provider";
import { useToast } from "@/components/toast";
import { Kbd, btn, input } from "@/components/ui";
import { CONDITION_LABEL, HOLD_LABEL } from "@/i18n/fr";
import { rpc } from "@/lib/client-data";
import type { Brand, Catalog, HoldReason, Item, ItemCondition, ItemStatus } from "@/lib/types";

const JACKET_SIZES = ["44", "46", "48", "50", "52", "54", "56", "58"];
const CONDITIONS = Object.keys(CONDITION_LABEL) as ItemCondition[];

interface Form {
  category_id: string | null;
  brand_id: string | null;
  size_label: string;
  condition: ItemCondition | null;
  color_id: string | null;
  defects: string;
}
const EMPTY: Form = { category_id: null, brand_id: null, size_label: "", condition: null, color_id: null, defects: "" };

export function ReceptionStation({ catalog, batches, initialBatch, orgId }: {
  catalog: Catalog; batches: { id: string; code: string; expected_qty: number | null }[];
  initialBatch: string | null; orgId: string;
}) {
  const toast = useToast();
  const [brands, setBrands] = useState<Brand[]>(catalog.brands);
  const [batchId, setBatchId] = useState<string | null>(initialBatch);
  const [sku, setSku] = useState("");
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ sku: string; status: ItemStatus }[]>([]);
  const [holdOpen, setHoldOpen] = useState(false);
  const skuRef = useRef<HTMLInputElement>(null);

  // Remember the batch for the whole session (a reception day is usually one batch)
  useEffect(() => {
    if (!initialBatch) {
      try {
        const saved = localStorage.getItem("receptionBatch");
        if (saved && batches.some((b) => b.id === saved)) setBatchId(saved);
      } catch {}
    }
  }, [initialBatch, batches]);
  useEffect(() => {
    try { if (batchId) localStorage.setItem("receptionBatch", batchId); } catch {}
  }, [batchId]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  useScan((scan) => {
    if (scan.kind === "item") {
      setSku(scan.code);
      return true;
    }
    if (scan.kind === "batch") {
      const b = batches.find((x) => x.code === scan.code);
      if (b) setBatchId(b.id);
      else toast(`Lot ${scan.code} introuvable ou clôturé`, "error");
      return true;
    }
    return false;
  });

  async function submit(next: ItemStatus, payload: Record<string, unknown> = {}) {
    if (!batchId) return toast("Choisissez d'abord le lot", "error");
    if (next === "sorted" && !form.category_id) return toast("Choisissez une catégorie (touches 1-9)", "error");
    setBusy(true);
    try {
      const item = await rpc<Item>("receive_item", {
        p_batch_id: batchId,
        p_sku: sku || null,
        p_attrs: { ...form, defects: form.defects || null },
        p_next: next,
        p_payload: payload,
      });
      setDone((d) => [{ sku: item.sku, status: item.status }, ...d].slice(0, 30));
      toast(`${item.sku} enregistré`, "ok");
      // category and condition usually repeat within a lot: keep them
      setForm((f) => ({ ...EMPTY, category_id: f.category_id, condition: f.condition }));
      setSku("");
      setHoldOpen(false);
      skuRef.current?.focus();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  // Keyboard: 1-9 category, Enter validate (outside text fields)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (typing && e.target !== skuRef.current) return;
      const cat = catalog.categories.find((c) => String(c.hotkey) === e.key);
      if (cat && !typing) {
        e.preventDefault();
        set("category_id", cat.id);
      } else if (e.key === "Enter" && !busy && (sku || !typing)) {
        e.preventDefault();
        submit("sorted");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const batch = batches.find((b) => b.id === batchId);
  const colors = catalog.attributes.filter((a) => a.kind === "color");

  if (!batches.length) {
    return (
      <div className="mx-auto max-w-md text-center">
        <p className="mb-4 text-lg">Aucun lot ouvert.</p>
        <Link href="/lots/nouveau" className={btn.primary}>Créer un lot</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_260px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold">Réception & tri</h1>
          <select className={`${input} w-auto font-mono`} value={batchId ?? ""} onChange={(e) => setBatchId(e.target.value || null)}>
            <option value="">— Lot —</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
          </select>
          {batch && <span className="text-sm text-muted">{done.length} traités cette session</span>}
        </div>

        <div className="rounded-xl border-2 border-dashed border-accent bg-panel p-4">
          <label className="mb-1 block text-xs font-semibold uppercase text-muted">Étiquette (scannez ou tapez)</label>
          <div className="flex gap-2">
            <input
              ref={skuRef}
              autoFocus
              className={`${input} font-mono text-2xl uppercase`}
              value={sku}
              onChange={(e) => setSku(e.target.value.toUpperCase())}
              placeholder="LSH00001"
              autoCapitalize="characters"
              autoComplete="off"
            />
          </div>
          <p className="mt-1 text-xs text-muted">Laissez vide pour attribuer automatiquement un nouveau SKU (étiquette à imprimer ensuite).</p>
        </div>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase text-muted">Catégorie</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {catalog.categories.map((c) => (
              <button
                key={c.id}
                onClick={() => set("category_id", c.id)}
                className={`min-h-14 rounded-lg border-2 px-3 text-left font-semibold ${
                  form.category_id === c.id ? "border-accent bg-accent text-accent-fg" : "border-line bg-panel"
                }`}
              >
                {c.hotkey && <Kbd>{c.hotkey}</Kbd>} {c.name}
              </button>
            ))}
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase text-muted">Marque</h2>
            <BrandPicker brands={brands} value={form.brand_id} onChange={(id) => set("brand_id", id)} orgId={orgId}
              onCreated={(b) => setBrands((x) => [...x, b].sort((a, z) => a.name.localeCompare(z.name)))} />
          </div>
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase text-muted">Taille</h2>
            <input className={input} value={form.size_label} onChange={(e) => set("size_label", e.target.value)} placeholder="50, 40R, M…" />
            <div className="mt-2 flex flex-wrap gap-1">
              {JACKET_SIZES.map((s) => (
                <button key={s} onClick={() => set("size_label", s)}
                  className={`min-h-10 min-w-11 rounded border px-2 font-mono ${form.size_label === s ? "border-accent bg-accent text-accent-fg" : "border-line"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase text-muted">État</h2>
          <div className="flex flex-wrap gap-2">
            {CONDITIONS.map((c) => (
              <button key={c} onClick={() => set("condition", c)}
                className={`min-h-11 rounded-lg border-2 px-3 text-sm font-medium ${form.condition === c ? "border-accent bg-accent text-accent-fg" : "border-line bg-panel"}`}>
                {CONDITION_LABEL[c]}
              </button>
            ))}
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          <select className={input} value={form.color_id ?? ""} onChange={(e) => set("color_id", e.target.value || null)}>
            <option value="">Couleur (optionnel)</option>
            {colors.map((c) => <option key={c.id} value={c.id}>{c.value}</option>)}
          </select>
          <input className={input} value={form.defects} onChange={(e) => set("defects", e.target.value)} placeholder="Défauts constatés (optionnel)" />
        </div>

        <div className="grid grid-cols-[1fr_auto_auto] gap-2">
          <button className={btn.huge} disabled={busy} onClick={() => submit("sorted")}>
            Valider → photo <Kbd>Entrée</Kbd>
          </button>
          <button className={`${btn.secondary} min-h-16`} disabled={busy} onClick={() => setHoldOpen((v) => !v)}>En attente</button>
          <button className={`${btn.danger} min-h-16`} disabled={busy}
            onClick={() => confirm("Écarter cet article (invendable) ?") && submit("rejected", { reason: form.defects || "Écarté au tri" })}>
            Écarter
          </button>
        </div>
        {holdOpen && (
          <div className="flex flex-wrap gap-2">
            {(Object.keys(HOLD_LABEL) as HoldReason[]).map((r) => (
              <button key={r} className={btn.secondary} onClick={() => submit("on_hold", { hold_reason: r })}>{HOLD_LABEL[r]}</button>
            ))}
          </div>
        )}
      </div>

      <aside className="rounded-xl border border-line bg-panel p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase text-muted">Derniers enregistrés</h2>
        <ul className="space-y-1 font-mono text-sm">
          {done.map((d) => (
            <li key={d.sku} className="flex justify-between">
              <Link href={`/stock/${d.sku}`} className="hover:underline">{d.sku}</Link>
              <span className="text-xs text-muted">{d.status === "sorted" ? "→ photo" : d.status === "on_hold" ? "attente" : "écarté"}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
