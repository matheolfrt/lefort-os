"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Box, Copy, Eye, Plus, RotateCw, Rows3, Trash2, View as ViewIcon } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm";
import { errorMessage } from "@/lib/errors";
import { input } from "@/components/ui";
import {
  MIN_AISLE, SHELF, clampToRoom, fits, freeSpot, inside, narrowAisles, newId, row, snap, stats,
  type Room, type Shelf,
} from "@/lib/warehouse";
import type { View } from "./scene";

// three.js runs in the browser only
const Scene = dynamic(() => import("./scene"), { ssr: false, loading: () => <div className="skeleton h-full w-full" /> });

const PLAN = "Mon futur local";
const SAVE_MS = 800;
const m = (v: number, d = 2) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: d })} m`;
const cm = (v: number) => `${Math.round(v * 100)} cm`;

export function Planner({ initial, canEdit, planId: initialId }: { initial: { room: Room; shelves: Shelf[] }; canEdit: boolean; planId: string | null }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [room, setRoom] = useState(initial.room);
  const [shelves, setShelves] = useState(initial.shelves);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("3d");
  const [rowN, setRowN] = useState(5);
  const [double, setDouble] = useState(false);
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved");
  const planId = useRef(initialId);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);

  const sel = shelves.find((s) => s.id === selected) ?? null;
  const st = useMemo(() => stats(room, shelves), [room, shelves]);
  const aisles = useMemo(() => narrowAisles(shelves), [shelves]);
  const outside = useMemo(() => shelves.filter((s) => !inside(room, s)), [room, shelves]);

  // ── saved as one goes (managers)
  const save = useCallback(async (plan: { room: Room; shelves: Shelf[] }) => {
    setStatus("saving");
    const db = supabaseBrowser();
    const { data, error } = planId.current
      ? await db.from("floor_plans").update({ plan }).eq("id", planId.current).select("id").single()
      : await db.from("floor_plans").insert({ name: PLAN, plan }).select("id").single();
    if (error) { setStatus("error"); toast(`Plan non enregistré : ${errorMessage(error)}`, "error"); return; }
    planId.current = data.id;
    setStatus("saved");
  }, [toast]);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!canEdit) return;
    if (timer.current) clearTimeout(timer.current);
    setStatus("saving");
    timer.current = setTimeout(() => void save({ room, shelves }), SAVE_MS);
  }, [room, shelves, canEdit, save]);

  // ── actions
  const add = () => {
    const s = freeSpot(room, shelves);
    if (!s) return toast("Plus de place libre dans le local.", "error");
    setShelves((l) => [...l, s]); setSelected(s.id);
  };
  const addRow = () => {
    const made = row(room, shelves, rowN, double);
    if (!made.length) return toast(`Pas de place pour une rangée de ${rowN}${double ? " double" : ""}.`, "error");
    setShelves((l) => [...l, ...made]); setSelected(made[0].id);
  };
  const update = (id: string, patch: Partial<Shelf>) => setShelves((l) => l.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const move = (dx: number, dz: number) => {
    if (!sel) return;
    const next = clampToRoom(room, { ...sel, x: snap(sel.x + dx), z: snap(sel.z + dz) });
    if (fits(room, next, shelves)) update(sel.id, { x: next.x, z: next.z });
    else toast("Une étagère est déjà là.", "error");
  };
  const rotate = () => {
    if (!sel) return;
    const next = clampToRoom(room, { ...sel, rot: sel.rot === 90 ? 0 : 90 });
    if (fits(room, next, shelves)) update(sel.id, { rot: next.rot, x: next.x, z: next.z });
    else toast("Pas la place de la tourner ici : déplacez-la d'abord.", "error");
  };
  const duplicate = () => {
    if (!sel) return;
    // next to it if possible, otherwise the first free place
    const candidates = [[sel.rot === 90 ? 0 : SHELF.w, 0], [0, sel.rot === 90 ? SHELF.w : SHELF.d]].map(([dx, dz]) => clampToRoom(room, { ...sel, id: newId(), x: sel.x + dx, z: sel.z + dz }));
    const s = candidates.find((c) => fits(room, c, shelves)) ?? (() => { const f = freeSpot(room, shelves, sel.rot); return f; })();
    if (!s) return toast("Plus de place libre dans le local.", "error");
    setShelves((l) => [...l, s]); setSelected(s.id);
  };
  const remove = () => {
    if (!sel) return;
    const gone = sel;
    setShelves((l) => l.filter((s) => s.id !== gone.id)); setSelected(null);
    toast("Étagère retirée", "ok", { action: { label: "Annuler", run: () => setShelves((l) => [...l, gone]) } });
  };
  async function clearAll() {
    if (!shelves.length) return;
    if (!(await confirm({ title: `Retirer les ${shelves.length} étagères ?`, message: "Le local reste ; vous pourrez annuler juste après.", confirmLabel: "Tout retirer", danger: true }))) return;
    const before = shelves;
    setShelves([]); setSelected(null);
    toast("Toutes les étagères ont été retirées", "ok", { action: { label: "Annuler", run: () => setShelves(before) } });
  }
  const setDim = (k: keyof Room, v: string) => {
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n) && n > 0) setRoom((r) => ({ ...r, [k]: Math.min(k === "h" ? 20 : 200, n) }));
  };

  // ── keyboard: arrows move by 10 cm (50 cm with Shift), R turns, D duplicates, Delete removes, Escape deselects
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || !canEdit || !sel) return;
      const step = e.shiftKey ? 0.5 : 0.1;
      const k = e.key;
      if (k === "ArrowLeft") move(-step, 0); else if (k === "ArrowRight") move(step, 0);
      else if (k === "ArrowUp") move(0, -step); else if (k === "ArrowDown") move(0, step);
      else if (k === "r" || k === "R") rotate(); else if (k === "d" || k === "D") duplicate();
      else if (k === "Delete" || k === "Backspace") remove(); else if (k === "Escape") setSelected(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const views: [View, string, typeof Box][] = [["3d", "Vue 3D", Box], ["top", "Vue de dessus", ViewIcon], ["walk", "À hauteur d'homme", Eye]];

  return (
    <div className="space-y-4" data-testid="planner">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">Mon futur local</h1>
          <p className="text-sm text-muted">
            {m(room.w, 1)} × {m(room.d, 1)} = <b className="text-fg">{st.area.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} m²</b>, {m(room.h, 1)} sous plafond.
            {" "}{canEdit ? "Faites glisser une étagère pour la déplacer ; tournez la vue avec la souris ou un doigt." : "Plan en lecture seule (les responsables le modifient)."}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-panel/70 p-1" role="group" aria-label="Point de vue">
          {views.map(([v, label, Icon]) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium ${view === v ? "bg-accent/15 text-accent" : "text-muted hover:text-fg"}`}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="relative h-[58vh] min-h-[360px] overflow-hidden rounded-2xl border border-line bg-panel xl:h-[calc(100dvh-210px)]">
          <Scene room={room} shelves={shelves} selected={selected} view={view} canEdit={canEdit}
            onSelect={setSelected} onMove={(id, x, z) => update(id, { x, z })} />
          {canEdit && (
            <span className="pointer-events-none absolute left-3 top-3 rounded-lg bg-black/55 px-2 py-1 text-xs text-white" role="status" data-testid="plan-status">
              {status === "saving" ? "Enregistrement…" : status === "error" ? "Non enregistré" : "Enregistré"}
            </span>
          )}
          {sel && canEdit && (
            <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-center gap-1.5 rounded-xl bg-panel/95 p-1.5 shadow-lg ring-1 ring-line backdrop-blur" data-testid="selection-bar">
              <span className="px-2 text-sm font-medium">Étagère sélectionnée</span>
              <span className="mr-auto text-xs text-muted">{m(sel.x)} · {m(sel.z)}</span>
              <Tool onClick={rotate} label="Pivoter (R)"><RotateCw size={16} /> Pivoter</Tool>
              <Tool onClick={duplicate} label="Dupliquer (D)"><Copy size={16} /> Dupliquer</Tool>
              <Tool onClick={remove} label="Retirer (Suppr)" danger><Trash2 size={16} /> Retirer</Tool>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          {canEdit && (
            <section className="space-y-3 rounded-2xl border border-line bg-panel/80 p-4" aria-labelledby="add-t">
              <h2 id="add-t" className="section-title">Étagères 5 niveaux · 60 × 120 × 200 cm</h2>
              <button onClick={add} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 font-semibold text-accent-fg" data-testid="add-shelf">
                <Plus size={18} /> Ajouter une étagère
              </button>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm"><span className="mb-1 block text-muted">Rangée de</span>
                  <input className={`${input} w-20 text-right`} type="number" min={1} max={30} value={rowN} name="row-n"
                    onChange={(e) => setRowN(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} /></label>
                <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={double} onChange={(e) => setDouble(e.target.checked)} className="size-5" /> dos à dos</label>
                <button onClick={addRow} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium ring-1 ring-inset ring-line hover:ring-fg/30" data-testid="add-row">
                  <Rows3 size={16} /> Ajouter la rangée
                </button>
              </div>
              <p className="text-xs text-muted">Glissez une étagère pour la placer (au 5 cm près). Clavier : flèches = 10 cm (Maj : 50 cm), R pivoter, D dupliquer, Suppr retirer.</p>
            </section>
          )}

          <section className="rounded-2xl border border-line bg-panel/80 p-4" aria-labelledby="sum-t" data-testid="plan-stats">
            <h2 id="sum-t" className="section-title mb-2">Ce que le local contient</h2>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted">Étagères</dt><dd className="text-right font-mono tabular-nums" data-stat="shelves">{st.shelves}</dd>
              <dt className="text-muted">Niveaux (tablettes)</dt><dd className="text-right font-mono tabular-nums">{st.levels}</dd>
              <dt className="text-muted">Longueur de tablettes</dt><dd className="text-right font-mono tabular-nums" data-stat="metres">{m(st.shelfMetres, 1)}</dd>
              <dt className="text-muted">Sol occupé</dt><dd className="text-right font-mono tabular-nums">{st.floorUsed.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} m² ({Math.round(st.floorPct)} %)</dd>
            </dl>
            {(aisles.length > 0 || outside.length > 0) && (
              <ul className="mt-3 space-y-1.5 text-sm" data-testid="plan-warnings">
                {aisles.length > 0 && (
                  <li className="flex items-start gap-2 rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-amber-900 dark:text-amber-200">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    {aisles.length} allée{aisles.length > 1 ? "s" : ""} de moins de {cm(MIN_AISLE)} (la plus étroite : {cm(Math.min(...aisles.map((a) => a.width)))}) : on y passe mal avec un carton.
                  </li>
                )}
                {outside.length > 0 && (
                  <li className="flex items-start gap-2 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-red-800 dark:text-red-200">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {outside.length} étagère{outside.length > 1 ? "s" : ""} hors du local : agrandissez-le ou déplacez-les.
                  </li>
                )}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-panel/80 p-4" aria-labelledby="room-t">
            <h2 id="room-t" className="section-title mb-2">Le local</h2>
            <div className="grid grid-cols-3 gap-2">
              {([["w", "Largeur"], ["d", "Longueur"], ["h", "Hauteur"]] as [keyof Room, string][]).map(([k, label]) => (
                <label key={k} className="text-sm"><span className="mb-1 block text-muted">{label} (m)</span>
                  <input className={`${input} text-right font-mono`} type="number" step={0.5} min={2} name={`room-${k}`} value={room[k]} disabled={!canEdit}
                    onChange={(e) => setDim(k, e.target.value)} /></label>
              ))}
            </div>
            {canEdit && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[[20, 10], [16, 12.5], [25, 8]].map(([w, d]) => (
                  <button key={`${w}x${d}`} onClick={() => setRoom((r) => ({ ...r, w, d }))} className="min-h-11 rounded-full px-3 text-xs text-muted ring-1 ring-inset ring-line hover:text-fg">
                    {w} × {String(d).replace(".", ",")} m (200 m²)
                  </button>
                ))}
              </div>
            )}
          </section>

          <details className="rounded-2xl border border-line bg-panel/80 p-4">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Liste des étagères ({shelves.length})</summary>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm">
              {shelves.map((s, i) => (
                <li key={s.id}>
                  <button onClick={() => setSelected(s.id)} aria-pressed={s.id === selected}
                    className={`flex min-h-11 w-full items-center justify-between rounded-lg px-2 text-left ${s.id === selected ? "bg-accent/10 text-accent" : "hover:bg-fg/5"}`}>
                    <span>Étagère {i + 1}{s.rot === 90 ? " (tournée)" : ""}</span><span className="font-mono text-xs text-muted">{m(s.x)} · {m(s.z)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {canEdit && shelves.length > 0 && <button onClick={clearAll} className="mt-2 min-h-11 text-sm text-red-600 hover:underline dark:text-red-400">Retirer toutes les étagères</button>}
          </details>
        </aside>
      </div>
    </div>
  );
}

function Tool({ onClick, label, danger, children }: { onClick: () => void; label: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={label}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium ring-1 ring-inset ring-line ${danger ? "text-red-600 hover:bg-red-500/10 dark:text-red-400" : "hover:bg-fg/5"}`}>
      {children}
    </button>
  );
}
