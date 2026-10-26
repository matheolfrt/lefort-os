"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ExternalLink, Loader2, Lock, Play, TriangleAlert, UserRound, X } from "lucide-react";
import { useToast } from "@/components/toast";
import { StatusChip, btn, input } from "@/components/ui";
import { STATUS_LABEL } from "@/i18n/fr";
import { dateTime, money } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  BLOCK_LABEL, COLUMN, COLUMNS, PRIORITIES, PRIORITY, moveKind, nextColumn, since, stationHref,
  type BlockReason, type BoardCard, type BoardStatus, type Priority,
} from "@/lib/production";
import type { ItemStatus } from "@/lib/types";
import { call, photoUrl, signPhotos } from "./api";
import type { Member } from "./production";

interface Event {
  id: number; type: string; from_status: ItemStatus | null; to_status: ItemStatus | null;
  station: string | null; actor_id: string | null; payload: Record<string, unknown>; created_at: string;
}

const STATION_NAME: Record<string, string> = {
  production: "Production", reception: "Réception", photo_measure: "Photo & mesures", photo: "Photo", measure: "Mesures",
  storage: "Rangement", listing: "Publication", shipping: "Expédition", sales: "Ventes", stock: "Stock",
  vinted_sync: "Synchro Vinted", batch: "Lot", sales_import: "Import ventes", vinted_import: "Import Vinted", csv_import: "Import CSV",
};

const stepName = (s: ItemStatus | null) => {
  if (!s) return "—";
  return (COLUMN as Record<string, { label: string } | undefined>)[s]?.label ?? STATUS_LABEL[s];
};

/** Item side panel: everything about one article, its next task, and the actions of the board */
export function ItemPanel({ card, isManager, me, members, onClose, onChange, onMove, onComplete }: {
  card: BoardCard;
  isManager: boolean;
  me: { id: string; name: string };
  members: Member[];
  onClose: () => void;
  onChange: (card: BoardCard) => void;
  onMove: (card: BoardCard, to: BoardStatus) => Promise<BoardCard | null>;
  onComplete: (card: BoardCard) => Promise<BoardCard | null>;
}) {
  const toast = useToast();
  const [c, setC] = useState(card);
  const [events, setEvents] = useState<Event[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [blockReason, setBlockReason] = useState<BlockReason>("missing_photos");
  const [blockNote, setBlockNote] = useState("");
  const [, setPhotoReady] = useState(0);
  const name = useCallback((id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? "Quelqu'un" : "Automatique"), [members]);

  const refresh = useCallback(async () => {
    const [{ data }, { data: ev }] = await Promise.all([
      call<BoardCard>("production_card", { p_item_id: card.id }),
      supabaseBrowser().from("item_events")
        .select("id, type, from_status, to_status, station, actor_id, payload, created_at")
        .eq("item_id", card.id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(60),
    ]);
    if (data) {
      setC(data);
      if (await signPhotos([data.photo_path])) setPhotoReady((n) => n + 1);
    }
    setEvents((ev ?? []) as Event[]);
  }, [card.id]);

  useEffect(() => { setC(card); refresh(); }, [card, refresh]);

  // Escape closes the panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const apply = (next: BoardCard | null) => {
    if (!next) return;
    setC(next);
    onChange(next);
    refresh();
  };

  async function run<T>(fn: string, args: Record<string, unknown>, ok?: string): Promise<T | null> {
    setBusy(true);
    const { data, error } = await call<T>(fn, args);
    setBusy(false);
    if (error) { toast(error.message, "error"); return null; }
    if (ok) toast(ok, "ok");
    return data;
  }

  const def = COLUMN[c.col];
  const next = nextColumn(c.col);
  const href = stationHref(c);
  const onHold = c.status === "on_hold";
  const sold = ["sold", "shipped", "completed"].includes(c.status);
  const margin = c.price_cents != null && c.cost_cents != null ? c.price_cents - c.cost_cents : null;
  const url = photoUrl(c.photo_path);
  const mine = c.assigned_to === me.id;
  const p = PRIORITY[c.priority] ?? PRIORITY[1];

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={`Article ${c.sku}`}>
      <button type="button" aria-label="Fermer" onClick={onClose} className="absolute inset-0 bg-black/55 backdrop-blur-[2px] panel-fade" />
      <aside className="panel-in relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-line bg-panel shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-panel/95 px-4 py-3 backdrop-blur">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-lg font-semibold">{c.sku}</div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <span>{def.emoji} {def.label}</span>
              <StatusChip status={c.status} />
              <span>· depuis {since(c.status_changed_at)}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="flex size-10 items-center justify-center rounded-full text-muted hover:bg-line/60 hover:text-fg">
            <X size={20} />
          </button>
        </header>

        <div className="space-y-4 p-4">
          <div className="flex gap-3">
            <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-bg text-xs text-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {url ? <img src={url} alt="" className="size-full object-cover" /> : `${c.photo_count} photo${c.photo_count > 1 ? "s" : ""}`}
            </div>
            <div className="min-w-0">
              <div className="text-lg font-semibold leading-tight">{c.brand ?? "Marque inconnue"}</div>
              <div className="text-sm text-fg/85">{c.title ?? "Sans titre"}</div>
              <div className="mt-1 text-sm text-muted">{[c.category, c.size && `Taille ${c.size}`].filter(Boolean).join(" · ") || "Catégorie et taille à renseigner"}</div>
              <div className={`mt-1 flex items-center gap-1.5 text-xs font-semibold ${p.text}`}><span className={`size-2 rounded-full ${p.dot}`} /> Priorité {p.label.toLowerCase()}</div>
            </div>
          </div>

          {/* Next task */}
          {!sold && (
            <section className="rounded-xl border border-accent/30 bg-accent/[0.06] p-3">
              <div className="eyebrow-tight text-accent">Prochaine tâche</div>
              {c.blocked_reason ? (
                <p className="mt-1 text-sm text-red-200">Bloqué : {BLOCK_LABEL[c.blocked_reason]}{c.blocked_note ? ` — ${c.blocked_note}` : ""}. Levez le blocage pour continuer.</p>
              ) : onHold ? (
                <p className="mt-1 text-sm">En attente — reprendre à l&apos;étape « {stepName(c.status_before_hold)} ».</p>
              ) : def.task ? (
                <p className="mt-1 text-sm"><span className="font-semibold">{def.task}</span> puis passer à « {next ? COLUMN[next].label : ""} ».</p>
              ) : (
                <p className="mt-1 text-sm text-muted">{c.col === "listed" ? "En ligne : en attente d'un acheteur." : c.col === "reserved" ? "Réservé : en attente du paiement." : "Expédié."}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {def.task && !c.blocked_reason && !onHold && (
                  <button type="button" disabled={busy} className={btn.secondary + " min-h-10"}
                    onClick={async () => {
                      const r = await run<BoardCard>("start_task", { p_item_id: c.id }, "Tâche commencée");
                      apply(r);
                    }}>
                    <Play size={15} /> Commencer
                  </button>
                )}
                {href && (
                  <Link href={href} className={btn.secondary + " min-h-10"}>Ouvrir le poste <ArrowRight size={15} /></Link>
                )}
                {(def.task && c.col !== "sold" || onHold) && !c.blocked_reason && (
                  <button type="button" disabled={busy} className={btn.primary + " min-h-10"}
                    onClick={async () => { setBusy(true); apply(await onComplete(c)); setBusy(false); }}>
                    ✓ {onHold ? "Reprendre" : "Terminer"}
                  </button>
                )}
              </div>
            </section>
          )}

          {/* Facts */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Fact label="Emplacement" value={c.location ? `${c.location.replace(/^EMP-/, "")}${c.location_label ? ` · ${c.location_label}` : ""}` : "—"} />
            <Fact label="Lot" value={c.batch ?? "—"} />
            <Fact label="Fournisseur" value={c.supplier ?? "—"} />
            <Fact label="Reçu" value={dateTime(c.received_at)} />
            {isManager && <Fact label="Prix d'achat" value={money(c.cost_cents)} />}
            <Fact label="Prix de vente" value={money(c.price_cents)} />
            {isManager && <Fact label="Marge brute" value={margin == null ? "—" : money(margin)} />}
            <Fact label="En cours" value={c.claimer ?? "—"} />
          </dl>

          {/* Priority */}
          <section>
            <div className="eyebrow-tight mb-1.5 text-muted">Priorité</div>
            <div className="grid grid-cols-4 gap-1.5">
              {PRIORITIES.map((o) => (
                <button key={o.value} type="button" disabled={busy} aria-pressed={c.priority === o.value}
                  onClick={async () => {
                    const r = await run<{ updated: number }>("set_item_priority", { p_item_ids: [c.id], p_priority: o.value });
                    if (r) apply({ ...c, priority: o.value as Priority });
                  }}
                  className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition ${
                    c.priority === o.value ? "border-fg/40 bg-panel-2 text-fg" : "border-line text-muted hover:border-fg/25"}`}>
                  <span className={`size-2 rounded-full ${o.dot}`} /> {o.label}
                </button>
              ))}
            </div>
          </section>

          {/* Blocking */}
          <section>
            <div className="eyebrow-tight mb-1.5 text-muted">Blocage</div>
            {c.blocked_reason ? (
              <div className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">
                <TriangleAlert size={16} className="mt-0.5 shrink-0 text-red-300" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-red-100">⚠️ BLOQUÉ · {BLOCK_LABEL[c.blocked_reason]}</div>
                  {c.blocked_note && <div className="text-red-100/80">{c.blocked_note}</div>}
                  {c.blocked_at && <div className="text-xs text-red-100/60">depuis {since(c.blocked_at)}</div>}
                </div>
                <button type="button" disabled={busy} className="rounded-lg bg-red-500/20 px-3 py-2 text-xs font-semibold text-red-100 hover:bg-red-500/30"
                  onClick={async () => apply(await run<BoardCard>("set_item_block", { p_item_id: c.id, p_reason: null }, "Blocage levé"))}>
                  Débloquer
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <select aria-label="Raison du blocage" className={input + " min-h-10 flex-1 text-sm"} value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value as BlockReason)}>
                  {Object.entries(BLOCK_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <input aria-label="Précision" placeholder={blockReason === "other" ? "Précisez (obligatoire)" : "Précision (facultatif)"}
                  className={input + " min-h-10 flex-1 text-sm"} value={blockNote} onChange={(e) => setBlockNote(e.target.value)} />
                <button type="button" disabled={busy} className={btn.secondary + " min-h-10 w-full text-sm"}
                  onClick={async () => {
                    const r = await run<BoardCard>("set_item_block", { p_item_id: c.id, p_reason: blockReason, p_note: blockNote || null }, "Article bloqué");
                    if (r) { setBlockNote(""); apply(r); }
                  }}>
                  <Lock size={15} /> Bloquer l&apos;article
                </button>
              </div>
            )}
          </section>

          {/* Assignment */}
          <section>
            <div className="eyebrow-tight mb-1.5 text-muted">Employé assigné</div>
            {isManager ? (
              <select aria-label="Employé assigné" className={input + " min-h-10 text-sm"} value={c.assigned_to ?? ""} disabled={busy}
                onChange={async (e) => {
                  const id = e.target.value || null;
                  const r = await run<{ updated: number }>("assign_items", { p_item_ids: [c.id], p_user_id: id }, id ? "Article attribué" : "Attribution retirée");
                  if (r) apply({ ...c, assigned_to: id, assignee: id ? name(id) : null });
                }}>
                <option value="">Personne</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === me.id ? " (moi)" : ""}</option>)}
              </select>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <UserRound size={16} className="text-muted" />
                <span className="flex-1">{c.assignee ?? "Personne"}</span>
                {(!c.assigned_to || mine) && (
                  <button type="button" disabled={busy} className={btn.secondary + " min-h-10 text-sm"}
                    onClick={async () => {
                      const id = mine ? null : me.id;
                      const r = await run<{ updated: number }>("assign_items", { p_item_ids: [c.id], p_user_id: id });
                      if (r) apply({ ...c, assigned_to: id, assignee: id ? me.name : null });
                    }}>
                    {mine ? "Rendre l'article" : "Me l'attribuer"}
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Move */}
          {!sold && (
            <section>
              <div className="eyebrow-tight mb-1.5 text-muted">Changer d&apos;étape</div>
              <select aria-label="Déplacer vers" className={input + " min-h-10 text-sm"} value="" disabled={busy}
                onChange={async (e) => {
                  const to = e.target.value as BoardStatus;
                  if (!to) return;
                  setBusy(true);
                  apply(await onMove(c, to));
                  setBusy(false);
                }}>
                <option value="">Déplacer vers…</option>
                {COLUMNS.map((col) => {
                  const k = moveKind(c, col.status, isManager);
                  if (k === "same" || k === "forbidden" || k === "blocked") return null;
                  return <option key={col.status} value={col.status}>{col.emoji} {col.label}{k === "manual" ? " (correction)" : k === "sale" ? " (écran dédié)" : ""}</option>;
                })}
              </select>
            </section>
          )}

          <div className="flex flex-wrap gap-2 text-sm">
            <Link href={`/stock/${encodeURIComponent(c.sku)}`} className={btn.secondary + " min-h-10"}>Fiche article</Link>
            {c.listing_url && (
              <a href={c.listing_url} target="_blank" rel="noreferrer" className={btn.secondary + " min-h-10"}>Annonce <ExternalLink size={14} /></a>
            )}
          </div>

          {/* History */}
          <section>
            <div className="eyebrow-tight mb-2 text-muted">Historique</div>
            {events === null ? (
              <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Chargement…</div>
            ) : events.length === 0 ? (
              <div className="text-sm text-muted">Aucun événement.</div>
            ) : (
              <ol className="relative space-y-3 border-l border-line pl-4" data-testid="history">
                {events.map((e) => (
                  <li key={e.id} className="relative text-sm">
                    <span className={`absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-panel ${e.type === "status" ? "bg-accent" : "bg-muted"}`} />
                    <div className="text-xs text-muted">{dateTime(e.created_at)} · {name(e.actor_id)}{e.station ? ` · ${STATION_NAME[e.station] ?? e.station}` : ""}</div>
                    <div>{describe(e, name)}</div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow-tight text-muted">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

function describe(e: Event, name: (id: string | null) => string): string {
  const p = e.payload ?? {};
  switch (e.type) {
    case "status": {
      const txt = e.from_status ? `${stepName(e.from_status)} → ${stepName(e.to_status)}` : `Créé · ${stepName(e.to_status)}`;
      return p.forced ? `${txt} (correction manuelle)` : txt;
    }
    case "start": return `A commencé la tâche (${stepName(e.from_status)})`;
    case "priority": return `Priorité : ${PRIORITY[Number(p.from) as Priority]?.label ?? "?"} → ${PRIORITY[Number(p.to) as Priority]?.label ?? "?"}`;
    case "block": return `Bloqué : ${BLOCK_LABEL[p.reason as BlockReason] ?? "?"}${p.note ? ` — ${p.note}` : ""}`;
    case "unblock": return "Blocage levé";
    case "assign": return p.to ? `Attribué à ${name(String(p.to))}` : "Attribution retirée";
    case "imported": return "Importé";
    case "deleted": return "Supprimé";
    case "restored": return "Restauré";
    case "sale_voided": return "Vente annulée";
    default: return e.type;
  }
}
