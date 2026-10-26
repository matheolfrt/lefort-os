"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Loader2, SkipForward, X } from "lucide-react";
import { btn, input } from "@/components/ui";
import { useToast } from "@/components/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { COLUMN, PRIORITY, nextColumn, since, stationHref, type BoardCard, type BoardStatus } from "@/lib/production";
import { call, photoUrl, signPhotos } from "./api";

type Phase = "loading" | "ready" | "working" | "done" | "empty";

/**
 * "Prochaine tâche": the system picks the item to handle now (in hand, assigned, urgent, oldest),
 * the employee starts it, finishes it, and goes straight to the next one.
 */
export function TaskMode({ columns, categories, onClose, onFinished }: {
  columns: BoardStatus[];
  categories: { id: string; name: string }[];
  onClose: () => void;
  /** a card left its column: the board updates without reloading */
  onFinished: (before: BoardCard, after: BoardCard) => void;
}) {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("loading");
  const [card, setCard] = useState<BoardCard | null>(null);
  const [skip, setSkip] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [, setPhotoReady] = useState(0);

  const load = useCallback(async (skipIds: string[]) => {
    setPhase("loading");
    setProblem(null);
    const { data, error } = await call<BoardCard | null>("next_task", { p_columns: columns, p_skip: skipIds });
    if (error) { toast(error.message, "error"); setPhase("empty"); return; }
    setCard(data && data.id ? data : null);
    if (data?.photo_path && await signPhotos([data.photo_path])) setPhotoReady((n) => n + 1);
    // an item already in the employee's hands continues where it was
    setPhase(!data?.id ? "empty" : data.claimed_by ? "working" : "ready");
  }, [columns, toast]);

  useEffect(() => { load([]); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function start() {
    if (!card) return;
    setBusy(true);
    const { data, error } = await call<BoardCard>("start_task", { p_item_id: card.id });
    setBusy(false);
    if (error) { toast(error.message, "error"); return; }
    setCard(data);
    setPhase("working");
  }

  async function finish() {
    if (!card) return;
    const to = nextColumn(card.col);
    if (!to) return;
    setBusy(true);
    setProblem(null);
    const { data, error } = await call<BoardCard>("kanban_move", { p_item_id: card.id, p_to: to, p_expected_version: card.version });
    setBusy(false);
    if (error) { setProblem(error.message); return; }
    onFinished(card, data!);
    setDoneCount((n) => n + 1);
    setPhase("done");
  }

  async function skipIt() {
    if (!card) return;
    await call("release_item", { p_item_id: card.id });
    const s = [...skip, card.id];
    setSkip(s);
    load(s);
  }

  // Sorting only needs the category: chosen right here, no need to open the reception station
  async function setCategory(id: string) {
    if (!card) return;
    const { error } = await supabaseBrowser().from("items").update({ category_id: id }).eq("id", card.id);
    if (error) { toast(error.message, "error"); return; }
    const { data } = await call<BoardCard>("production_card", { p_item_id: card.id });
    if (data) setCard(data);
    setProblem(null);
  }

  const def = card ? COLUMN[card.col] : null;
  const p = card ? PRIORITY[card.priority] ?? PRIORITY[1] : null;
  const href = card ? stationHref(card) : null;
  const url = card ? photoUrl(card.photo_path) : null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/65 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Prochaine tâche">
      <div className="panel-in relative w-full max-w-lg rounded-t-3xl border border-line bg-panel p-5 shadow-2xl sm:rounded-3xl sm:p-6">
        <button type="button" onClick={onClose} aria-label="Fermer" className="absolute right-3 top-3 flex size-10 items-center justify-center rounded-full text-muted hover:bg-line/60 hover:text-fg">
          <X size={20} />
        </button>
        <div className="eyebrow text-accent">▶ Prochaine tâche</div>
        {doneCount > 0 && <div className="mt-0.5 text-xs text-muted">{doneCount} tâche{doneCount > 1 ? "s" : ""} terminée{doneCount > 1 ? "s" : ""} dans cette session</div>}

        {phase === "loading" && (
          <div className="flex h-56 items-center justify-center text-muted"><Loader2 className="animate-spin" /></div>
        )}

        {phase === "empty" && (
          <div className="py-10 text-center">
            <div className="text-4xl">🎉</div>
            <div className="mt-2 text-lg font-semibold">Plus rien à faire ici</div>
            <p className="text-sm text-muted">Aucune tâche disponible dans tes étapes (les articles bloqués ou pris par un collègue sont ignorés).</p>
            <button type="button" className={btn.secondary + " mt-4"} onClick={onClose}>Retour au tableau</button>
          </div>
        )}

        {phase === "done" && (
          <div className="py-8 text-center">
            <CheckCircle2 size={48} className="mx-auto text-accent" />
            <div className="mt-2 text-xl font-bold">✓ Tâche terminée</div>
            <p className="text-sm text-muted">{card?.sku} est passé à l&apos;étape suivante.</p>
            <button type="button" autoFocus className={btn.huge + " mt-5"} onClick={() => load(skip)}>
              Prochaine tâche <ArrowRight />
            </button>
            <button type="button" className="mt-3 text-sm text-muted underline-offset-2 hover:underline" onClick={onClose}>Faire une pause</button>
          </div>
        )}

        {(phase === "ready" || phase === "working") && card && def && p && (
          <div className="mt-3">
            <div className="text-3xl font-black tracking-tight">{def.taskEmoji} {def.task?.toUpperCase()}</div>
            <div className="mt-4 flex gap-4">
              <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-bg text-xs text-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {url ? <img src={url} alt="" className="size-full object-cover" /> : "Pas de photo"}
              </div>
              <div className="min-w-0 space-y-0.5">
                <div className="text-xl font-bold leading-tight">{card.brand ?? "Marque inconnue"}</div>
                <div className="text-fg/85">{card.title ?? card.category ?? "Sans titre"}</div>
                {card.size && <div className="text-muted">Taille {card.size}</div>}
                <div className="font-mono text-lg font-semibold">{card.sku}</div>
                {card.location && <div className="text-sm text-muted">📍 {card.location.replace(/^EMP-/, "")}</div>}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span className={`flex items-center gap-1.5 font-semibold ${p.text}`}><span className={`size-2.5 rounded-full ${p.dot}`} /> Priorité : {p.label}</span>
              <span className="text-muted">⏱ dans l&apos;étape depuis {since(card.status_changed_at)}</span>
              {card.assignee && <span className="text-muted">Assigné : {card.assignee}</span>}
            </div>

            {card.col === "received" && !card.category && (
              <label className="mt-4 block">
                <span className="eyebrow-tight mb-1.5 block text-muted">Catégorie (pour le tri)</span>
                <select className={input} defaultValue="" onChange={(e) => e.target.value && setCategory(e.target.value)}>
                  <option value="" disabled>Choisir…</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}

            {problem && (
              <div role="alert" className="mt-4 rounded-xl border border-highlight/40 bg-highlight/10 p-3 text-sm">
                <div className="font-semibold">Pas encore terminé</div>
                <div className="text-fg/85">{problem}</div>
                {href && <Link href={href} className="mt-1 inline-flex items-center gap-1 font-semibold text-accent hover:underline">Ouvrir le poste pour compléter <ArrowRight size={14} /></Link>}
              </div>
            )}

            <div className="mt-5 grid gap-2">
              {phase === "ready" ? (
                <button type="button" autoFocus disabled={busy} className={btn.huge} onClick={start}>COMMENCER</button>
              ) : (
                <>
                  {href && card.col !== "received" && (
                    <Link href={href} className={btn.secondary + " min-h-12"}>Ouvrir le poste {def.label.toLowerCase()} <ArrowRight size={16} /></Link>
                  )}
                  {card.col === "sold" ? (
                    <Link href={href ?? "/postes/expedition"} className={btn.huge}>Expédier la commande</Link>
                  ) : (
                    <button type="button" autoFocus disabled={busy} className={btn.huge} onClick={finish}>
                      {busy ? <Loader2 className="animate-spin" /> : "✓ TERMINER"}
                    </button>
                  )}
                </>
              )}
              <button type="button" disabled={busy} onClick={skipIt}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 text-sm text-muted hover:text-fg">
                <SkipForward size={15} /> Passer cet article
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
