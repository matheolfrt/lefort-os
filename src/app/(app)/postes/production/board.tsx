"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDownUp, Check, ImageOff, Loader2, PauseCircle, TriangleAlert } from "lucide-react";
import { money } from "@/lib/format";
import {
  BLOCK_LABEL, COLUMN, PRIORITIES, PRIORITY, moveKind, since,
  type BoardCard, type BoardStatus, type ColumnDef, type ColumnTotals, type MoveKind, type Priority, type SortKey, SORTS,
} from "@/lib/production";
import { HOLD_LABEL } from "@/i18n/fr";
import type { HoldReason } from "@/lib/types";
import { photoUrl } from "./api";

export interface ColumnState {
  def: ColumnDef;
  totals: ColumnTotals;
  items: BoardCard[];
  loading: boolean;
}

// Fixed card height: lets each column render only the cards in view (thousands of items stay smooth)
const CARD_H = 158;
const GAP = 8;
const ROW = CARD_H + GAP;
const OVERSCAN = 4;

interface BoardProps {
  columns: ColumnState[];
  sorts: Partial<Record<BoardStatus, SortKey>>;
  isManager: boolean;
  fresh: Set<string>;
  onSort: (col: BoardStatus, key: SortKey) => void;
  onLoadMore: (col: BoardStatus) => void;
  onOpen: (card: BoardCard) => void;
  onComplete: (card: BoardCard) => void;
  onPriority: (card: BoardCard, p: Priority) => void;
  onDrop: (card: BoardCard, to: BoardStatus) => void;
}

export function Board(props: BoardProps) {
  const { columns, isManager } = props;
  const boardRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ card: BoardCard; over: BoardStatus | null; w: number } | null>(null);
  const pt = useRef({ x: 0, y: 0, offX: 0, offY: 0 });
  const frame = useRef(0);
  const lastDragEnd = useRef(0);
  const onDropRef = useRef(props.onDrop);
  onDropRef.current = props.onDrop;
  const onOpenRef = useRef(props.onOpen);
  onOpenRef.current = props.onOpen;
  const dragging = useRef(false);

  // The browser only waits for the page before scrolling under a finger if a blocking touch listener exists when
  // the touch starts: this one is always there and stops the scroll only once a card has been picked up.
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => { if (dragging.current) e.preventDefault(); };
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, []);

  const colAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y)?.closest("[data-col]")?.getAttribute("data-col") as BoardStatus | null) ?? null;

  const paint = useCallback(() => {
    frame.current = 0;
    const { x, y, offX, offY } = pt.current;
    if (ghostRef.current) ghostRef.current.style.transform = `translate3d(${x - offX}px, ${y - offY}px, 0) rotate(1.5deg)`;
    const over = colAt(x, y);
    setDrag((d) => (d && d.over !== over ? { ...d, over } : d));
  }, []);

  // Edge auto-scroll while dragging: sideways along the board, up/down inside the column under the finger
  useEffect(() => {
    if (!drag) return;
    let raf = 0;
    const tick = () => {
      const { x, y } = pt.current;
      const board = boardRef.current;
      if (board) {
        const r = board.getBoundingClientRect();
        const edge = 70;
        if (x < r.left + edge) board.scrollLeft -= Math.ceil((r.left + edge - x) / 5);
        else if (x > r.right - edge) board.scrollLeft += Math.ceil((x - (r.right - edge)) / 5);
      }
      const body = document.elementFromPoint(x, y)?.closest("[data-col]")?.querySelector<HTMLElement>("[data-col-body]");
      if (body) {
        const r = body.getBoundingClientRect();
        if (y < r.top + 50) body.scrollTop -= Math.ceil((r.top + 50 - y) / 4);
        else if (y > r.bottom - 50) body.scrollTop += Math.ceil((y - (r.bottom - 50)) / 4);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [drag]);

  const startDrag = useCallback((e: React.PointerEvent<HTMLElement>, card: BoardCard) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, a, select, input, label")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    const touch = e.pointerType !== "mouse";
    let started = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const begin = (x: number, y: number) => {
      started = true;
      pt.current = { x, y, offX: start.x - rect.left, offY: start.y - rect.top };
      setDrag({ card, over: card.col, w: rect.width });
      dragging.current = true;
      document.body.style.userSelect = "none";
      window.getSelection()?.removeAllRanges();
      if (touch) navigator.vibrate?.(8);
    };
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      dragging.current = false;
      document.body.style.userSelect = "";
    };
    const move = (ev: PointerEvent) => {
      if (!started) {
        const dist = Math.hypot(ev.clientX - start.x, ev.clientY - start.y);
        // touch: a long press picks the card up, moving earlier is a scroll
        if (touch) { if (dist > 8) cleanup(); return; }
        if (dist < 6) return;
        begin(ev.clientX, ev.clientY);
      }
      pt.current.x = ev.clientX;
      pt.current.y = ev.clientY;
      if (!frame.current) frame.current = requestAnimationFrame(paint);
    };
    const up = (ev: PointerEvent) => {
      cleanup();
      if (!started) return;
      lastDragEnd.current = Date.now();
      const to = colAt(ev.clientX, ev.clientY);
      setDrag(null);
      if (to) onDropRef.current(card, to);
    };
    const cancel = () => {
      cleanup();
      if (started) { lastDragEnd.current = Date.now(); setDrag(null); }
    };
    if (touch) timer = setTimeout(() => begin(start.x, start.y), 230);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  }, [paint]);

  const open = useCallback((card: BoardCard) => {
    // the click that ends a drag must not open the card
    if (Date.now() - lastDragEnd.current > 300) onOpenRef.current(card);
  }, []);

  return (
    <div className="relative">
      <div ref={boardRef} className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 md:mx-0 md:snap-none md:px-0"
        role="list" aria-label="Chaîne de production">
        {columns.map((c) => (
          <Column key={c.def.status} state={c} {...props}
            dropKind={drag ? moveKind(drag.card, c.def.status, isManager) : null}
            isOver={drag?.over === c.def.status}
            draggingId={drag?.card.id ?? null}
            onPointerDownCard={startDrag}
            onOpenCard={open}
          />
        ))}
      </div>
      {drag && (
        <div ref={ghostRef} aria-hidden
          className="pointer-events-none fixed left-0 top-0 z-50 opacity-95 drop-shadow-[0_18px_30px_rgba(0,0,0,0.55)]"
          style={{ width: drag.w, transform: `translate3d(${pt.current.x - pt.current.offX}px, ${pt.current.y - pt.current.offY}px, 0) rotate(1.5deg)` }}>
          <CardView card={drag.card} isManager={isManager} ghost />
        </div>
      )}
    </div>
  );
}

const DROP_STYLE: Record<MoveKind, string> = {
  same: "",
  usual: "border-accent/70 bg-accent/[0.06]",
  manual: "border-highlight/70 border-dashed bg-highlight/[0.05]",
  sale: "border-sky-400/60 border-dashed bg-sky-400/[0.05]",
  blocked: "border-red-500/40 opacity-60",
  forbidden: "opacity-40",
};
const DROP_HINT: Partial<Record<MoveKind, string>> = {
  usual: "Déposer ici",
  manual: "Correction manuelle",
  sale: "Ouvrir l'écran dédié",
  blocked: "Article bloqué",
  forbidden: "Non autorisé",
};

function Column({ state, sorts, isManager, fresh, onSort, onLoadMore, onComplete, onPriority, dropKind, isOver, draggingId, onPointerDownCard, onOpenCard }:
  BoardProps & {
    state: ColumnState; dropKind: MoveKind | null; isOver: boolean; draggingId: string | null;
    onPointerDownCard: (e: React.PointerEvent<HTMLElement>, card: BoardCard) => void;
    onOpenCard: (card: BoardCard) => void;
  }) {
  const { def, totals, items, loading } = state;
  const body = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, h: 800 });
  const sort = sorts[def.status] ?? "priority";

  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView((v) => ({ ...v, h: el.clientHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const first = Math.max(0, Math.floor(view.top / ROW) - OVERSCAN);
  const last = Math.min(items.length, Math.ceil((view.top + view.h) / ROW) + OVERSCAN);
  const more = items.length < totals.count;

  // progressive loading: the next page comes when the end of what is loaded scrolls into view
  useEffect(() => {
    if (more && !loading && last >= items.length - 6) onLoadMore(def.status);
  }, [more, loading, last, items.length, def.status, onLoadMore]);

  const onScroll = () => {
    const el = body.current;
    if (el) setView({ top: el.scrollTop, h: el.clientHeight });
  };

  return (
    <section data-col={def.status} role="listitem" aria-label={def.label}
      className={`flex w-[84vw] max-w-[300px] shrink-0 snap-start flex-col rounded-2xl border bg-panel/70 transition-colors duration-150 sm:w-[280px] ${
        dropKind && dropKind !== "same" ? DROP_STYLE[dropKind] : "border-line"
      } ${isOver && dropKind === "usual" ? "ring-2 ring-accent/50" : ""} ${isOver && dropKind === "manual" ? "ring-2 ring-highlight/50" : ""}`}>
      <header className="border-b border-line/70 px-3 pb-2.5 pt-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="eyebrow truncate text-fg"><span aria-hidden className="mr-1.5">{def.emoji}</span>{def.label}</h2>
          <label className="relative flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-line/60 hover:text-fg" title="Trier la colonne">
            <ArrowDownUp size={15} />
            <select aria-label={`Trier ${def.label} par`} value={sort} onChange={(e) => onSort(def.status, e.target.value as SortKey)}
              className="absolute inset-0 cursor-pointer appearance-none opacity-0">
              {SORTS.filter((s) => !s.manager || isManager).map((s) => <option key={s.value} value={s.value}>Trier par : {s.label}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="figure text-2xl font-semibold tabular-nums leading-none" data-testid={`count-${def.status}`}>{totals.count}</span>
          <span className="text-xs text-muted">article{totals.count > 1 ? "s" : ""}</span>
          {sort !== "priority" && <span className="ml-auto text-[11px] text-muted">{SORTS.find((s) => s.value === sort)?.label}</span>}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-muted">
          <span className={totals.in_progress ? "text-accent" : ""}>{totals.in_progress} en cours</span>
          {totals.blocked > 0 && <span className="text-red-300">{totals.blocked} bloqué{totals.blocked > 1 ? "s" : ""}</span>}
          {totals.value_cents > 0
            ? <span>Valeur {money(totals.value_cents)}</span>
            : totals.cost_cents ? <span>Coût {money(totals.cost_cents)}</span> : null}
        </div>
        {def.task && <div className="mt-1 text-[11px] text-muted/80">À faire : {def.task.toLowerCase()}</div>}
      </header>

      <div ref={body} data-col-body onScroll={onScroll}
        className="relative h-[calc(100dvh-330px)] min-h-[380px] overflow-y-auto overscroll-contain px-2 py-2 md:h-[calc(100dvh-300px)]">
        {dropKind && isOver && DROP_HINT[dropKind] && (
          <div className="sticky top-0 z-10 mb-2 rounded-lg bg-panel-2/95 px-2 py-1 text-center text-xs font-medium text-muted">
            {DROP_HINT[dropKind]}
          </div>
        )}
        {items.length === 0 && !loading && (
          <div className="mt-6 px-3 text-center text-sm text-muted/70">Aucun article</div>
        )}
        <div style={{ height: items.length * ROW, position: "relative" }}>
          {items.slice(first, last).map((card, i) => (
            <div key={card.id} style={{ position: "absolute", top: (first + i) * ROW, left: 0, right: 0, height: CARD_H }}>
              <Card card={card} isManager={isManager} fresh={fresh.has(card.id)} dragging={draggingId === card.id}
                onPointerDown={onPointerDownCard} onOpen={onOpenCard} onComplete={onComplete} onPriority={onPriority} />
            </div>
          ))}
        </div>
        {(loading || more) && (
          <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted">
            <Loader2 size={14} className="animate-spin" /> Chargement…
          </div>
        )}
      </div>
    </section>
  );
}

const Card = memo(function Card({ card, isManager, fresh, dragging, onPointerDown, onOpen, onComplete, onPriority }: {
  card: BoardCard; isManager: boolean; fresh: boolean; dragging: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLElement>, card: BoardCard) => void;
  onOpen: (card: BoardCard) => void;
  onComplete: (card: BoardCard) => void;
  onPriority: (card: BoardCard, p: Priority) => void;
}) {
  return (
    <div onPointerDown={(e) => onPointerDown(e, card)}
      // no text selection when a drag starts with the mouse
      onMouseDown={(e) => { if (!(e.target as HTMLElement).closest("button, a, select, input, label")) e.preventDefault(); }}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => { if (!(e.target as HTMLElement).closest("button, a, select, label")) onOpen(card); }}
      className={`h-full cursor-grab select-none active:cursor-grabbing [-webkit-touch-callout:none] ${dragging ? "opacity-25" : ""} ${fresh ? "card-in" : ""}`}
      data-card={card.sku}>
      <CardView card={card} isManager={isManager} onComplete={onComplete} onPriority={onPriority} onOpen={onOpen} />
    </div>
  );
});

function CardView({ card, isManager, ghost, onComplete, onPriority, onOpen }: {
  card: BoardCard; isManager: boolean; ghost?: boolean;
  onComplete?: (card: BoardCard) => void;
  onPriority?: (card: BoardCard, p: Priority) => void;
  onOpen?: (card: BoardCard) => void;
}) {
  const p = PRIORITY[card.priority] ?? PRIORITY[1];
  const url = photoUrl(card.photo_path);
  const def = COLUMN[card.col];
  const onHold = card.status === "on_hold";
  const blocked = !!card.blocked_reason;
  const inProgress = !!card.claimed_by;
  const action = onHold ? "Reprendre" : def.task ? "Terminer" : null;

  return (
    <article className={`flex h-full flex-col rounded-xl border bg-panel-2 p-2.5 transition hover:border-fg/25 ${
      blocked ? "border-red-500/50 shadow-[inset_3px_0_0_0_rgb(239_68_68)]" : onHold ? "border-yellow-400/40 shadow-[inset_3px_0_0_0_rgb(250_204_21)]"
        : card.priority === 3 ? "border-line shadow-[inset_3px_0_0_0_rgb(239_68_68)]" : "border-line"}`}>
      <div className="flex h-5 items-center gap-1.5 text-[11px]">
        <label className={`relative flex items-center gap-1 rounded-full font-semibold ${card.priority >= 2 ? p.text : "text-muted"}`} title={`Priorité ${p.label.toLowerCase()}`}>
          <span className={`size-2 rounded-full ${p.dot}`} />
          {card.priority >= 2 && <span className="font-mono tracking-wide">{p.short}</span>}
          {!ghost && onPriority && (
            <select aria-label={`Priorité de ${card.sku}`} value={card.priority} onChange={(e) => onPriority(card, Number(e.target.value) as Priority)}
              className="absolute inset-0 -m-1 cursor-pointer appearance-none opacity-0">
              {PRIORITIES.map((o) => <option key={o.value} value={o.value}>Priorité : {o.label}</option>)}
            </select>
          )}
        </label>
        {blocked && (
          <span className="flex min-w-0 items-center gap-1 truncate rounded-full bg-red-500/15 px-1.5 font-semibold text-red-200" title={card.blocked_note ?? undefined}>
            <TriangleAlert size={11} className="shrink-0" /> <span className="truncate">BLOQUÉ · {BLOCK_LABEL[card.blocked_reason!]}</span>
          </span>
        )}
        {!blocked && onHold && (
          <span className="flex min-w-0 items-center gap-1 truncate rounded-full bg-yellow-400/15 px-1.5 font-semibold text-yellow-200">
            <PauseCircle size={11} className="shrink-0" /> <span className="truncate">En attente · {HOLD_LABEL[(card.hold_reason ?? "other") as HoldReason]}</span>
          </span>
        )}
        {!blocked && !onHold && inProgress && (
          <span className="flex min-w-0 items-center gap-1 truncate text-accent">
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" /> <span className="truncate">En cours{card.claimer ? ` · ${card.claimer.split(" ")[0]}` : ""}</span>
          </span>
        )}
        <span className="ml-auto shrink-0 font-mono text-muted" title={`Dans cette étape depuis le ${new Date(card.status_changed_at).toLocaleString("fr-FR")}`}>⏱ {since(card.status_changed_at)}</span>
      </div>

      <div className="mt-1.5 flex min-h-0 gap-2.5">
        <div className="flex size-[52px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-bg/80 text-muted/50">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="size-full object-cover" draggable={false} loading="lazy" />
          ) : <ImageOff size={18} />}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-semibold">{card.brand ?? "Marque ?"}{card.size ? <span className="font-normal text-muted"> · T{card.size}</span> : null}</div>
          <div className="truncate text-[13px] text-fg/80">{card.title ?? card.category ?? "Sans titre"}</div>
          <div className="mt-0.5 flex min-w-0 gap-2 text-[11px] text-muted">
            <span className="shrink-0 font-mono font-medium text-fg/85">{card.sku}</span>
            {card.location && <span className="truncate">📍 {card.location.replace(/^EMP-/, "")}</span>}
          </div>
        </div>
      </div>

      <div className="mt-auto flex items-center gap-1.5 pt-1.5">
        <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
          {isManager && card.cost_cents != null
            ? <>{money(card.cost_cents)} → <span className="text-fg/90">{card.price_cents ? money(card.price_cents) : "—"}</span></>
            : card.price_cents ? <span className="text-fg/90">{money(card.price_cents)}</span> : null}
          {card.assignee && <span className="ml-1.5 rounded bg-line/70 px-1 py-px font-sans text-[10px] text-fg/80" title={`Attribué à ${card.assignee}`}>{initials(card.assignee)}</span>}
        </div>
        {!ghost && (
          <>
            <button type="button" onClick={() => onOpen?.(card)}
              className="min-h-8 rounded-lg border border-line px-2 text-xs font-medium text-muted transition hover:border-fg/30 hover:text-fg">Ouvrir</button>
            {action && (
              <button type="button" onClick={() => onComplete?.(card)} disabled={blocked}
                title={blocked ? "Article bloqué" : def.task ? `${def.task} → étape suivante` : undefined}
                className="flex min-h-8 items-center gap-1 rounded-lg bg-accent/15 px-2 text-xs font-semibold text-accent ring-1 ring-inset ring-accent/30 transition hover:bg-accent/25 disabled:opacity-40">
                <Check size={13} /> {action}
              </button>
            )}
          </>
        )}
      </div>
    </article>
  );
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
