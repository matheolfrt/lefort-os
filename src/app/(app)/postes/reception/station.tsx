"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BrandPicker } from "@/components/brand-picker";
import { StationHeader } from "@/components/station-header";
import { useScan } from "@/components/scan-provider";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm";
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
  const confirm = useConfirm();
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
      <div className="mx-auto max-w-md rounded-2xl border border-line bg-panel/80 p-6 text-center">
        <p className="mb-4 text-lg font-semibold">Aucun lot ouvert.</p>
        <Link href="/lots/nouveau" className={btn.primary}>Créer un lot</Link>
      </div>
    );
  }

  const pick = (on: boolean) =>
    on ? "border-fg bg-fg text-bg" : "border-line bg-panel hover:border-fg/30";

  return (
    <div className="mx-auto max-w-5xl">
      <StationHeader title="Réception & tri" done={done.length}>
        <select className={`${input} w-full font-mono sm:w-auto`} value={batchId ?? ""} onChange={(e) => setBatchId(e.target.value || null)} aria-label="Lot">
          <option value="">— Choisir le lot —</option>
          {batches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
        </select>
      </StationHeader>

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div className="space-y-4">
          <div className="rounded-xl border-2 border-dashed border-fg/25 bg-panel p-4 focus-within:border-accent">
            <label htmlFor="reception-sku" className="mb-1 block eyebrow text-muted">Étiquette — scannez ou tapez</label>
            <input
              id="reception-sku"
              ref={skuRef}
              autoFocus
              className={`${input} min-h-14 font-mono text-2xl uppercase`}
              value={sku}
              onChange={(e) => setSku(e.target.value.toUpperCase())}
              placeholder="LSH00001"
              autoCapitalize="characters"
              autoComplete="off"
            />
            <p className="mt-1.5 text-xs text-muted">Vide = nouveau SKU attribué automatiquement (étiquette à imprimer ensuite).</p>
          </div>

          <section className="rounded-2xl border border-line bg-panel/80 p-4">
            <h2 className="mb-2 eyebrow text-muted">Catégorie <span className="hidden font-normal normal-case sm:inline">· touches 1 à 9</span></h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {catalog.categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => set("category_id", c.id)}
                  className={`flex min-h-14 items-center gap-2 rounded-lg border px-3 text-left font-semibold transition active:scale-[0.98] ${pick(form.category_id === c.id)}`}
                >
                  {c.hotkey && <Kbd>{c.hotkey}</Kbd>} {c.name}
                </button>
              ))}
            </div>
          </section>

          <section className="grid gap-4 rounded-2xl border border-line bg-panel/80 p-4 sm:grid-cols-2">
            <div>
              <h2 className="mb-2 eyebrow text-muted">Marque</h2>
              <BrandPicker brands={brands} value={form.brand_id} onChange={(id) => set("brand_id", id)} orgId={orgId}
                onCreated={(b) => setBrands((x) => [...x, b].sort((a, z) => a.name.localeCompare(z.name)))} />
            </div>
            <div>
              <h2 className="mb-2 eyebrow text-muted">Taille</h2>
              <input className={input} value={form.size_label} onChange={(e) => set("size_label", e.target.value)} placeholder="50, 40R, M…" aria-label="Taille" />
              <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                {JACKET_SIZES.map((s) => (
                  <button key={s} onClick={() => set("size_label", s)}
                    className={`min-h-11 rounded-md border font-mono font-semibold transition active:scale-[0.97] ${pick(form.size_label === s)}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-panel/80 p-4">
            <h2 className="mb-2 eyebrow text-muted">État</h2>
            <div className="flex flex-wrap gap-2">
              {CONDITIONS.map((c) => (
                <button key={c} onClick={() => set("condition", c)}
                  className={`min-h-11 rounded-lg border px-3 text-sm font-semibold transition active:scale-[0.98] ${pick(form.condition === c)}`}>
                  {CONDITION_LABEL[c]}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <select className={input} value={form.color_id ?? ""} onChange={(e) => set("color_id", e.target.value || null)} aria-label="Couleur">
                <option value="">Couleur (optionnel)</option>
                {colors.map((c) => <option key={c.id} value={c.id}>{c.value}</option>)}
              </select>
              <input className={input} value={form.defects} onChange={(e) => set("defects", e.target.value)} placeholder="Défauts constatés (optionnel)" aria-label="Défauts" />
            </div>
          </section>

          {/* Actions stay reachable above the phone's bottom bar */}
          <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 space-y-2 rounded-2xl bg-bg/90 py-2 backdrop-blur md:bottom-3">
            <div className="grid grid-cols-[1fr_auto_auto] gap-2">
              <button className={btn.huge} disabled={busy} onClick={() => submit("sorted")}>
                Valider → photo <span className="hidden sm:inline"><Kbd>Entrée</Kbd></span>
              </button>
              <button className={`${btn.secondary} min-h-16`} disabled={busy} onClick={() => setHoldOpen((v) => !v)} aria-expanded={holdOpen}>Attente</button>
              <button className={`${btn.secondary} min-h-16 text-red-700 dark:text-red-400`} disabled={busy}
                onClick={async () => {
                  const a = await confirm({ title: "Écarter cet article ?", message: "Il sort de la chaîne (invendable).", danger: true,
                    confirmLabel: "Écarter", reason: { label: "Motif", initial: form.defects, placeholder: "Trop abîmé, tache…", optional: true } });
                  if (a) submit("rejected", { reason: a.reason || "Écarté au tri" });
                }}>
                Écarter
              </button>
            </div>
            {holdOpen && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(Object.keys(HOLD_LABEL) as HoldReason[]).map((r) => (
                  <button key={r} className={btn.secondary} onClick={() => submit("on_hold", { hold_reason: r })}>{HOLD_LABEL[r]}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="h-fit rounded-2xl border border-line bg-panel/80 p-3">
          <h2 className="mb-2 eyebrow text-muted">Derniers enregistrés {batch && `· ${batch.code}`}</h2>
          {done.length === 0 ? (
            <p className="text-sm text-muted">Rien pour l&apos;instant.</p>
          ) : (
            <ul className="divide-y divide-line">
              {done.map((d) => (
                <li key={d.sku} className="flex min-h-10 items-center justify-between">
                  <Link href={`/stock/${d.sku}`} className="font-mono text-sm font-semibold hover:text-accent">{d.sku}</Link>
                  <span className="text-xs text-muted">{d.status === "sorted" ? "→ photo" : d.status === "on_hold" ? "en attente" : "écarté"}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
