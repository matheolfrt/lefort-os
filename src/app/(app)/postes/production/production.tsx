"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Camera, Crown, Play, RefreshCw, ScanLine, SlidersHorizontal, TriangleAlert, UserRound, X } from "lucide-react";
import { useConfirm } from "@/components/confirm";
import { useScan, useScanApi } from "@/components/scan-provider";
import { useToast } from "@/components/toast";
import { PageHeader, btn, input } from "@/components/ui";
import { parseEuros } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  COLUMN, COLUMNS, moveKind, nextColumn, stationHref,
  type BoardCard, type BoardData, type BoardStatus, type ColumnTotals, type Filters, type Priority, type SortKey,
} from "@/lib/production";
import { call, signPhotos } from "./api";
import { Board, type ColumnState } from "./board";
import { ManagerPanel, Welcome, startOfToday, type Stats } from "./insights";
import { ItemPanel } from "./panel";
import { TaskMode } from "./task-mode";

export interface Member { id: string; name: string; role: string }
export interface RefData {
  members: Member[];
  brands: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  batches: { id: string; code: string }[];
}
export interface Overview {
  name: string | null;
  role: string;
  columns: BoardStatus[];
  priorities: { urgent: number; high: number; normal: number; low: number } | null;
  by_column: Partial<Record<BoardStatus, number>> | null;
  assigned_to_me: number;
  done_today: number;
}

const PAGE = 30;
const store = {
  get<T>(k: string, fallback: T): T {
    try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
  },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const emptyTotals = (status: BoardStatus): ColumnTotals => ({ status, count: 0, in_progress: 0, blocked: 0, value_cents: 0, cost_cents: null });
const isBlocked = (c: BoardCard) => !!c.blocked_reason || c.status === "on_hold";

function adjust(t: ColumnTotals, c: BoardCard, sign: 1 | -1): ColumnTotals {
  return {
    ...t,
    count: Math.max(0, t.count + sign),
    in_progress: Math.max(0, t.in_progress + (c.claimed_by ? sign : 0)),
    blocked: Math.max(0, t.blocked + (isBlocked(c) ? sign : 0)),
    value_cents: t.value_cents + sign * (c.price_cents ?? 0),
    cost_cents: t.cost_cents == null && c.cost_cents == null ? t.cost_cents : (t.cost_cents ?? 0) + sign * (c.cost_cents ?? 0),
  };
}

function build(data: BoardData | null): Record<BoardStatus, ColumnState> {
  const out = {} as Record<BoardStatus, ColumnState>;
  for (const def of COLUMNS) {
    out[def.status] = {
      def,
      totals: data?.columns.find((c) => c.status === def.status) ?? emptyTotals(def.status),
      items: (data?.items ?? []).filter((i) => i.col === def.status),
      loading: false,
    };
  }
  return out;
}

/** Filters sent to the database: empty values dropped */
function clean(f: Filters): Filters {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== "" && v !== false && !(Array.isArray(v) && v.length === 0))) as Filters;
}

export function Production({ initialBoard, initialError, overview: initialOverview, refData: ref, me }: {
  initialBoard: BoardData | null;
  initialError: string | null;
  overview: Overview | null;
  refData: RefData;
  me: { id: string; name: string; isManager: boolean };
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { openCamera } = useScanApi();
  const isManager = initialBoard?.is_manager ?? me.isManager;

  const [cols, setCols] = useState(() => build(initialBoard));
  const colsRef = useRef(cols);
  colsRef.current = cols;
  const [filters, setFilters] = useState<Filters>({});
  const [draft, setDraft] = useState<Filters>({});
  const [sorts, setSorts] = useState<Partial<Record<BoardStatus, SortKey>>>({});
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<BoardCard | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [managerMode, setManagerMode] = useState(false);
  const [welcomeCollapsed, setWelcomeCollapsed] = useState(false);
  const [overview, setOverview] = useState(initialOverview);
  const [myStats, setMyStats] = useState<Stats["total"] | null>(null);
  const [statsKey, setStatsKey] = useState(0);
  const [guard, setGuard] = useState<{ card: BoardCard; to: BoardStatus; message: string } | null>(null);
  const [error, setError] = useState(initialError);
  const [refreshing, setRefreshing] = useState(false);
  const req = useRef(0);
  const firstLoad = useRef(true);

  // per-viewer preferences
  useEffect(() => {
    setSorts(store.get("lefort.production.sorts", {}));
    setManagerMode(me.isManager && store.get("lefort.production.manager", false));
    setWelcomeCollapsed(store.get("lefort.production.welcome-collapsed", false));
  }, [me.isManager]);

  const sign = useCallback(async (items: BoardCard[]) => {
    const paths = items.map((i) => i.photo_path);
    if (!(await signPhotos(paths))) return;
    const set = new Set(paths.filter(Boolean));
    // new object identities so the memoised cards pick up their photo
    setCols((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next) as BoardStatus[]) {
        next[k] = { ...next[k], items: next[k].items.map((i) => (i.photo_path && set.has(i.photo_path) ? { ...i } : i)) };
      }
      return next;
    });
  }, []);

  useEffect(() => { if (initialBoard) sign(initialBoard.items); }, [initialBoard, sign]);

  const load = useCallback(async (f: Filters, s: Partial<Record<BoardStatus, SortKey>>) => {
    const id = ++req.current;
    setRefreshing(true);
    const { data, error } = await call<BoardData>("production_board", { p_filters: clean(f), p_sorts: s, p_limit: PAGE });
    if (id !== req.current) return;
    setRefreshing(false);
    if (error) { setError(error.message); return; }
    setError(null);
    setCols(build(data));
    if (data) sign(data.items);
  }, [sign]);

  const refreshSide = useCallback(async () => {
    const [{ data: ov }, { data: st }] = await Promise.all([
      call<Overview>("production_overview"),
      call<Stats>("production_stats", { p_from: startOfToday() }),
    ]);
    if (ov) setOverview(ov);
    const mine = st?.people.find((p) => p.user_id === me.id);
    setMyStats(mine ? { n: mine.n, timed: mine.timed, secs: mine.secs } : null);
    setStatsKey((k) => k + 1);
  }, [me.id]);
  useEffect(() => { refreshSide(); }, [refreshSide]);

  const sideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const refreshSideSoon = useCallback(() => {
    clearTimeout(sideTimer.current);
    sideTimer.current = setTimeout(refreshSide, 900);
  }, [refreshSide]);

  // filters typed in the bar apply after a short pause
  useEffect(() => {
    const t = setTimeout(() => setFilters(draft), 300);
    return () => clearTimeout(t);
  }, [draft]);
  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return; }
    load(filters, sorts);
    // sorts reload a single column (see onSort)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, load]);

  // coming back to the tab: fresh numbers (other people work on the line too)
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") { load(filters, sorts); refreshSide(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [filters, sorts, load, refreshSide]);

  const loadColumn = useCallback(async (col: BoardStatus, replace: boolean, sortOverride?: Partial<Record<BoardStatus, SortKey>>) => {
    const current = colsRef.current[col];
    if (current.loading) return;
    setCols((p) => ({ ...p, [col]: { ...p[col], loading: true } }));
    const { data, error } = await call<BoardData>("production_board", {
      p_filters: clean(filters), p_sorts: sortOverride ?? sorts, p_limit: PAGE, p_column: col, p_offset: replace ? 0 : current.items.length,
    });
    setCols((p) => {
      if (error || !data) return { ...p, [col]: { ...p[col], loading: false } };
      const seen = new Set(replace ? [] : p[col].items.map((i) => i.id));
      const items = replace ? data.items : [...p[col].items, ...data.items.filter((i) => !seen.has(i.id))];
      return { ...p, [col]: { ...p[col], items, totals: data.columns[0] ?? p[col].totals, loading: false } };
    });
    if (error) toast(error.message, "error");
    if (data) sign(data.items);
  }, [filters, sorts, sign, toast]);

  const onLoadMore = useCallback((col: BoardStatus) => loadColumn(col, false), [loadColumn]);
  const onSort = useCallback((col: BoardStatus, key: SortKey) => {
    const next = { ...sorts, [col]: key };
    setSorts(next);
    store.set("lefort.production.sorts", next);
    loadColumn(col, true, next);
  }, [sorts, loadColumn]);

  /** Moves a card between columns in the local state (counters included), with a short arrival animation */
  const place = useCallback((before: BoardCard, after: BoardCard) => {
    setCols((prev) => {
      const next = { ...prev };
      const src = next[before.col];
      if (src) next[before.col] = { ...src, items: src.items.filter((i) => i.id !== before.id), totals: adjust(src.totals, before, -1) };
      const dst = next[after.col];
      if (dst) next[after.col] = { ...dst, items: [after, ...dst.items.filter((i) => i.id !== after.id)], totals: adjust(dst.totals, after, 1) };
      return next;
    });
    setFresh((s) => new Set(s).add(after.id));
    setTimeout(() => setFresh((s) => { const n = new Set(s); n.delete(after.id); return n; }), 900);
  }, []);

  /** Replaces a card in place (priority, block, assignment…) or moves it when its column changed */
  const update = useCallback((card: BoardCard) => {
    const all = Object.values(colsRef.current).flatMap((c) => c.items);
    const old = all.find((i) => i.id === card.id);
    if (!old) return;
    if (old.col !== card.col) { place(old, card); return; }
    setCols((prev) => ({
      ...prev,
      [card.col]: {
        ...prev[card.col],
        items: prev[card.col].items.map((i) => (i.id === card.id ? { ...card, rn: i.rn } : i)),
        totals: adjust(adjust(prev[card.col].totals, old, -1), card, 1),
      },
    }));
  }, [place]);

  const send = useCallback(async (card: BoardCard, to: BoardStatus, force: boolean): Promise<BoardCard | null> => {
    const optimistic: BoardCard = { ...card, col: to, status: to, claimed_by: null, claimer: null, status_changed_at: new Date().toISOString(),
      blocked_reason: force ? null : card.blocked_reason, hold_reason: null };
    place(card, optimistic);
    const { data, error } = await call<BoardCard>("kanban_move", { p_item_id: card.id, p_to: to, p_expected_version: card.version, p_force: force });
    if (error || !data) {
      place(optimistic, card);
      if (error?.code === "LF422") setGuard({ card, to, message: error.message });
      else if (error?.code === "LF412") { toast(error.message, "error"); load(filters, sorts); }
      else toast(error?.message ?? "Erreur", "error");
      return null;
    }
    place(optimistic, data);
    toast(`${card.sku} → ${COLUMN[data.col].label}`, "ok");
    refreshSideSoon();
    return data;
  }, [place, toast, load, filters, sorts, refreshSideSoon]);

  /** Every way of moving a card (drag & drop, "Terminer", the panel) goes through here */
  const moveCard = useCallback(async (card: BoardCard, to: BoardStatus): Promise<BoardCard | null> => {
    const kind = moveKind(card, to, isManager);
    if (kind === "same") return null;
    if (kind === "blocked") { toast("Article bloqué : levez le blocage avant de le faire avancer (Ouvrir → Débloquer).", "error"); return null; }
    if (kind === "forbidden") {
      toast(["sold", "shipped", "completed"].includes(card.status) ? "Article vendu : annulation ou retour depuis l'écran Ventes."
        : to === "sold" ? "Seul un article prêt à publier, en ligne ou réservé peut être vendu."
        : to === "shipped" ? "Un article s'expédie depuis la colonne Vendu, au poste Expédition."
        : "Seul un responsable peut faire sauter une étape ou revenir en arrière.", "error");
      return null;
    }
    if (kind === "sale") {
      const sale = to === "sold";
      const ok = await confirm({
        title: sale ? "Enregistrer la vente" : "Expédier la commande",
        message: sale ? `Une vente s'enregistre avec son prix et ses frais : l'écran Ventes s'ouvre avec ${card.sku}.`
          : `L'expédition se valide au poste Expédition (transporteur, numéro de suivi).`,
        confirmLabel: sale ? "Ouvrir Ventes" : "Ouvrir l'expédition",
      });
      if (ok) router.push(sale ? `/ventes?article=${encodeURIComponent(card.sku)}` : stationHref(card) ?? "/postes/expedition");
      return null;
    }
    if (kind === "manual") {
      const ok = await confirm({
        title: "Déplacement inhabituel",
        message: (
          <>⚠️ Cette action fait passer directement cet article de « {COLUMN[card.col].label} » à « {COLUMN[to].label} ».
            {card.blocked_reason ? " Son blocage sera levé." : ""} Continuer ?</>
        ),
        confirmLabel: "Continuer",
      });
      if (!ok) return null;
      return send(card, to, true);
    }
    return send(card, to, false);
  }, [isManager, toast, confirm, router, send]);

  const onComplete = useCallback(async (card: BoardCard) => {
    if (card.status === "on_hold") return moveCard(card, card.col);
    if (card.col === "sold") { router.push(stationHref(card) ?? "/postes/expedition"); return null; }
    const to = nextColumn(card.col);
    return to ? moveCard(card, to) : null;
  }, [moveCard, router]);

  const onPriority = useCallback(async (card: BoardCard, p: Priority) => {
    update({ ...card, priority: p });
    const { error } = await call("set_item_priority", { p_item_ids: [card.id], p_priority: p });
    if (error) { update(card); toast(error.message, "error"); }
  }, [update, toast]);

  const openCard = useCallback((card: BoardCard) => setPanel(card), []);

  // Scanner (hardware wedge, camera or typed): opens the item here instead of its stock page
  const openSku = useCallback(async (code: string) => {
    const { data } = await supabaseBrowser().from("items").select("id").eq("sku", code.trim().toUpperCase()).is("deleted_at", null).maybeSingle();
    if (!data) { toast(`${code} : article introuvable`, "error"); return; }
    const { data: card, error } = await call<BoardCard>("production_card", { p_item_id: data.id });
    if (error || !card) { toast(error?.message ?? "Article introuvable", "error"); return; }
    setScanOpen(false);
    setPanel(card);
  }, [toast]);
  useScan((scan) => {
    if (scan.kind !== "item") return false;
    openSku(scan.code);
    return true;
  });

  const visible = useMemo(() => {
    const keep = filters.columns?.length ? filters.columns : COLUMNS.map((c) => c.status);
    return COLUMNS.filter((c) => keep.includes(c.status)).map((c) => cols[c.status]);
  }, [cols, filters.columns]);

  const activeFilters = Object.keys(clean({ ...draft, q: undefined, assigned: draft.assigned === "me" ? undefined : draft.assigned, blocked: undefined })).length;
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }));
  const firstName = (overview?.name || me.name || "").split(/\s+/)[0];

  return (
    <div className="space-y-3">
      <PageHeader back="/postes" title="Production"
        subtitle="Glissez une carte vers l'étape suivante, ou laissez-vous guider tâche après tâche."
        actions={<>
          <button type="button" className={btn.secondary} onClick={() => setScanOpen(true)}><ScanLine size={18} /> Scanner</button>
          <button type="button" className={btn.secondary} onClick={() => setTaskOpen(true)}><Play size={18} /> Prochaine tâche</button>
          {me.isManager && (
            <button type="button" aria-pressed={managerMode}
              className={`${btn.secondary} ${managerMode ? "border-highlight/60 text-highlight" : ""}`}
              onClick={() => { setManagerMode((m) => { store.set("lefort.production.manager", !m); return !m; }); }}>
              <Crown size={18} /> Mode manager
            </button>
          )}
        </>} />

      {overview && (
        <Welcome overview={overview} firstName={firstName} myStats={myStats} onStart={() => setTaskOpen(true)}
          collapsed={welcomeCollapsed}
          onToggle={() => setWelcomeCollapsed((c) => { store.set("lefort.production.welcome-collapsed", !c); return !c; })} />
      )}

      {managerMode && me.isManager && <ManagerPanel refreshKey={statsKey} />}

      {/* Filters */}
      <section className="rounded-2xl border border-line bg-panel/70 p-2.5" aria-label="Filtres">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-48 flex-1">
            <span className="sr-only">Recherche</span>
            <input type="search" className={input + " min-h-10 pl-9 text-sm"} placeholder="🔎 SKU, marque, titre, taille…" value={draft.q ?? ""}
              onChange={(e) => set({ q: e.target.value })} data-testid="board-search" />
            <ScanLine size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          </label>
          <Toggle on={draft.assigned === "me"} onClick={() => set({ assigned: draft.assigned === "me" ? undefined : "me" })}>
            <UserRound size={15} /> Mes articles
          </Toggle>
          <Toggle on={!!draft.blocked} onClick={() => set({ blocked: !draft.blocked })} tone="red">
            <TriangleAlert size={15} /> Bloqués
          </Toggle>
          <Toggle on={showFilters} onClick={() => setShowFilters((s) => !s)}>
            <SlidersHorizontal size={15} /> Filtres{activeFilters ? ` (${activeFilters})` : ""}
          </Toggle>
          {(Object.keys(clean(draft)).length > 0) && (
            <button type="button" onClick={() => setDraft({})} className="flex min-h-10 items-center gap-1 rounded-xl px-2 text-sm text-muted hover:text-fg">
              <X size={15} /> Effacer
            </button>
          )}
          <button type="button" aria-label="Actualiser" title="Actualiser" onClick={() => { load(filters, sorts); refreshSide(); }}
            className="ml-auto flex size-10 items-center justify-center rounded-xl text-muted hover:bg-line/60 hover:text-fg">
            <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
        {showFilters && (
          <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-line pt-2.5 md:grid-cols-4 xl:grid-cols-6">
            <Select label="Marque" value={draft.brand_id} onChange={(v) => set({ brand_id: v })} options={ref.brands.map((b) => [b.id, b.name])} />
            <Small label="Taille"><input className={input + " min-h-10 text-sm"} value={draft.size ?? ""} onChange={(e) => set({ size: e.target.value })} placeholder="52, L…" /></Small>
            <Select label="Catégorie" value={draft.category_id} onChange={(v) => set({ category_id: v })} options={ref.categories.map((c) => [c.id, c.name])} />
            <Select label="Fournisseur" value={draft.supplier_id} onChange={(v) => set({ supplier_id: v })} options={ref.suppliers.map((s) => [s.id, s.name])} />
            <Select label="Lot" value={draft.batch_id} onChange={(v) => set({ batch_id: v })} options={ref.batches.map((b) => [b.id, b.code])} />
            <Select label="Employé assigné" value={draft.assigned} onChange={(v) => set({ assigned: v })}
              options={[["me", "Moi"], ["none", "Personne"], ...ref.members.filter((m) => m.id !== me.id).map((m) => [m.id, m.name] as [string, string])]} />
            <Range label="Âge du stock (jours)" min={draft.age_min} max={draft.age_max} onChange={(a, b) => set({ age_min: a, age_max: b })} />
            {isManager && <Range label="Prix d'achat (€)" euros min={draft.cost_min} max={draft.cost_max} onChange={(a, b) => set({ cost_min: a, cost_max: b })} />}
            <Range label="Prix de vente (€)" euros min={draft.price_min} max={draft.price_max} onChange={(a, b) => set({ price_min: a, price_max: b })} />
            <div className="col-span-2 md:col-span-4 xl:col-span-6">
              <div className="eyebrow-tight mb-1.5 text-muted">Statut (colonnes affichées)</div>
              <div className="flex flex-wrap gap-1.5">
                {COLUMNS.map((c) => {
                  const on = !draft.columns?.length || draft.columns.includes(c.status);
                  return (
                    <button key={c.status} type="button" aria-pressed={on}
                      onClick={() => {
                        const cur = draft.columns?.length ? draft.columns : COLUMNS.map((x) => x.status);
                        const next = on ? cur.filter((s) => s !== c.status) : [...cur, c.status];
                        set({ columns: next.length === COLUMNS.length || next.length === 0 ? undefined : COLUMNS.map((x) => x.status).filter((s) => next.includes(s)) });
                      }}
                      className={`min-h-9 rounded-lg border px-2.5 text-xs font-medium transition ${on ? "border-fg/30 bg-panel-2 text-fg" : "border-line text-muted/60"}`}>
                      {c.emoji} {c.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">
          {/function .* does not exist|Could not find the function/i.test(error)
            ? "La mise à jour de la base de données « 20261031000012_production_board.sql » n'a pas encore été exécutée dans Supabase."
            : error}
        </div>
      )}

      <Board columns={visible} sorts={sorts} isManager={isManager} fresh={fresh}
        onSort={onSort} onLoadMore={onLoadMore} onOpen={openCard} onComplete={onComplete} onPriority={onPriority} onDrop={moveCard} />

      {panel && (
        <ItemPanel key={panel.id} card={panel} isManager={isManager} me={{ id: me.id, name: me.name }} members={ref.members}
          onClose={() => setPanel(null)} onChange={update} onMove={moveCard} onComplete={onComplete} />
      )}

      {taskOpen && (
        <TaskMode columns={overview?.columns ?? []} categories={ref.categories}
          onClose={() => { setTaskOpen(false); refreshSide(); }}
          onFinished={(before, after) => {
            const known = Object.values(colsRef.current).some((c) => c.items.some((i) => i.id === before.id));
            if (known) place(before, after); else load(filters, sorts);
            refreshSideSoon();
          }} />
      )}

      {scanOpen && <ScanDialog onClose={() => setScanOpen(false)} onCode={openSku} onCamera={() => { setScanOpen(false); openCamera(); }} />}

      {guard && (
        <GuardDialog guard={guard} isManager={isManager} onClose={() => setGuard(null)}
          onForce={() => { const g = guard; setGuard(null); send(g.card, g.to, true); }} />
      )}
    </div>
  );
}

function Toggle({ on, onClick, children, tone }: { on: boolean; onClick: () => void; children: React.ReactNode; tone?: "red" }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`flex min-h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition ${
        on ? (tone === "red" ? "border-red-500/50 bg-red-500/15 text-red-100" : "border-accent/50 bg-accent/15 text-fg") : "border-line text-muted hover:border-fg/25 hover:text-fg"}`}>
      {children}
    </button>
  );
}

function Small({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="eyebrow-tight mb-1 block text-muted">{label}</span>{children}</label>;
}

function Select({ label, value, onChange, options }: { label: string; value?: string; onChange: (v: string | undefined) => void; options: [string, string][] }) {
  return (
    <Small label={label}>
      <select className={input + " min-h-10 text-sm"} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">Tous</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </Small>
  );
}

function Range({ label, min, max, onChange, euros }: { label: string; min?: number; max?: number; euros?: boolean; onChange: (a?: number, b?: number) => void }) {
  const show = (v?: number) => (v == null ? "" : euros ? String(v / 100).replace(".", ",") : String(v));
  const [a, setA] = useState(show(min));
  const [b, setB] = useState(show(max));
  useEffect(() => { if (min == null) setA(""); if (max == null) setB(""); }, [min, max]);
  const parse = (s: string) => {
    if (!s.trim()) return undefined;
    if (euros) return parseEuros(s) ?? undefined;
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  return (
    <Small label={label}>
      <div className="flex gap-1.5">
        <input inputMode="decimal" aria-label={`${label} minimum`} placeholder="min" className={input + " min-h-10 text-sm"} value={a}
          onChange={(e) => { setA(e.target.value); onChange(parse(e.target.value), parse(b)); }} />
        <input inputMode="decimal" aria-label={`${label} maximum`} placeholder="max" className={input + " min-h-10 text-sm"} value={b}
          onChange={(e) => { setB(e.target.value); onChange(parse(a), parse(e.target.value)); }} />
      </div>
    </Small>
  );
}

/** 📷 Scanner: a field that takes the scanner's input (or typing), plus the camera */
function ScanDialog({ onClose, onCode, onCamera }: { onClose: () => void; onCode: (code: string) => void; onCamera: () => void }) {
  const [code, setCode] = useState("");
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 p-4 pt-[15vh] backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Scanner un article"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="panel-in w-full max-w-md space-y-3 rounded-2xl border border-line bg-panel p-4 shadow-2xl"
        onSubmit={(e) => { e.preventDefault(); if (code.trim()) onCode(code); }}>
        <div className="flex items-center gap-2">
          <ScanLine className="text-accent" />
          <h2 className="font-bold">Scanner un article</h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="ml-auto flex size-9 items-center justify-center rounded-full text-muted hover:bg-line/60"><X size={18} /></button>
        </div>
        <p className="text-sm text-muted">Scannez l&apos;étiquette avec la douchette, ou tapez le SKU. La fiche s&apos;ouvre avec son étape et sa prochaine tâche.</p>
        <input autoFocus className={input + " font-mono text-lg uppercase"} placeholder="M-12, LSH000123…" value={code}
          onChange={(e) => setCode(e.target.value)} aria-label="SKU" />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={btn.secondary} onClick={onCamera}><Camera size={18} /> Caméra</button>
          <button type="submit" className={btn.primary}>Ouvrir <ArrowRight size={18} /></button>
        </div>
      </form>
    </div>
  );
}

/** A usual step refused by its rule (photos, measures, storage, price…): where to finish it, or force for a manager */
function GuardDialog({ guard, isManager, onClose, onForce }: {
  guard: { card: BoardCard; to: BoardStatus; message: string }; isManager: boolean; onClose: () => void; onForce: () => void;
}) {
  const href = stationHref(guard.card);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="alertdialog" aria-modal="true" aria-label="Étape non terminée"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel-in w-full max-w-md space-y-3 rounded-t-3xl border border-line bg-panel p-5 shadow-2xl sm:rounded-3xl">
        <div className="flex items-center gap-2 font-bold"><TriangleAlert className="text-highlight" /> Étape « {COLUMN[guard.card.col].task?.toLowerCase()} » pas terminée</div>
        <p className="text-sm"><span className="font-mono font-semibold">{guard.card.sku}</span> ne peut pas passer à « {COLUMN[guard.to].label} » : {guard.message}</p>
        <div className="grid gap-2">
          {href && <Link href={href} className={btn.primary}>Ouvrir le poste pour compléter <ArrowRight size={18} /></Link>}
          {isManager && <button type="button" className={btn.secondary} onClick={onForce}>Forcer quand même (correction manuelle)</button>}
          <button type="button" className="min-h-11 text-sm text-muted hover:text-fg" onClick={onClose}>Annuler</button>
        </div>
      </div>
    </div>
  );
}
