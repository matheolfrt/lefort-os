"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Check, ChevronRight, Crosshair, ExternalLink, Flame, Loader2, MapPin, Maximize2, Minus, PackageCheck, Plus, Route as RouteIcon,
  Search, Settings2, Warehouse as WarehouseIcon, X,
} from "lucide-react";
import { rpc } from "@/lib/client-data";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/toast";
import { errorMessage } from "@/lib/errors";
import { STATUS_LABEL } from "@/i18n/fr";
import { btn, input, seg } from "@/components/ui";
import type { ItemStatus } from "@/lib/types";
import {
  capacity, frontPoint, layout, levelId, readConfig, slotPoint, withRacks, type WarehouseConfig, type Zone,
} from "@/lib/warehouse3d/config";
import { grid, route, walk, type Pt } from "@/lib/warehouse3d/path";
import {
  GROUPS, METRICS, NEXT, groupOf, kpis, ramp, readHeat, readSnapshot, shelfHeat, type Group, type HeatLevel, type Metric, type Snapshot, type WItem,
} from "@/lib/warehouse3d/model";
import type { Highlight, Pick, SceneHandle } from "./scene3d";

const Scene3D = dynamic(() => import("./scene3d"), { ssr: false, loading: () => <div className="skeleton absolute inset-0" /> });

type Mode = "stock" | "performance" | "picking" | "config";
const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur = (c: number | null | undefined) => (c == null ? "—" : euro.format(Math.round(c / 100)));
const num = (n: number) => n.toLocaleString("fr-FR");
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "—");
const shelfKey = (rack: string, shelf: number) => `${rack}-${String(shelf).padStart(2, "0")}`;

interface Card {
  id: string; sku: string; title: string | null; status: ItemStatus; version: number; brand: string | null; category: string | null; size: string | null; color: string | null;
  cost_cents: number | null; price_cents: number | null; sold_cents: number | null; received_at: string; listed_at: string | null; sold_at: string | null;
  photo: string | null; platform: string | null; views: number | null; favourites: number | null;
  location: { id: string; code: string; label: string | null; kind: string; rack: string | null; shelf_no: number | null; level_no: number | null; position: number | null } | null;
  history: { at: string; kind: "status" | "move"; from: string | null; to: string | null; type: string; by: string | null }[];
}
interface QueueRow { order_id: string; order_number: number; buyer_handle: string | null; sold_at: string; item_id: string; sku: string; title: string | null; size_label: string | null; location_code: string | null; item_status: ItemStatus }
interface Stop { item: string; sku: string; order: number; at: Pt; text: string; level: string | null; done: boolean; highlight: Highlight | null }

export function WarehouseApp({ warehouses, warehouseId, isManager }: { warehouses: { id: string; name: string }[]; warehouseId: string; isManager: boolean }) {
  const toast = useToast();
  const scene = useRef<SceneHandle>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("stock");
  const [visible, setVisible] = useState<Set<Group>>(new Set(GROUPS.map((g) => g.id)));
  const [sel, setSel] = useState<{ shelf: string | null; level: number | null; item: string | null; zone: string | null }>({ shelf: null, level: null, item: null, zone: null });
  const [card, setCard] = useState<Card | null>(null);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [path, setPath] = useState<Pt[] | null>(null);
  const [q, setQ] = useState("");
  const [placing, setPlacing] = useState<WItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(false);
  // performance
  const [metric, setMetric] = useState<Metric>("value");
  const [heatRaw, setHeatRaw] = useState<HeatLevel[] | null>(null);
  // picking
  const [queue, setQueue] = useState<QueueRow[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState<{ stops: Stop[]; legs: Pt[][]; current: number; off: QueueRow[] } | null>(null);
  // configuration (managers): a draft drawn live, saved on demand
  const [draft, setDraft] = useState<WarehouseConfig | null>(null);

  // ── data: the snapshot first (the building appears as soon as it is there), the rest on demand
  const refresh = useCallback(async () => {
    try { setSnap(readSnapshot(await rpc("warehouse_snapshot", { p_warehouse_id: warehouseId }))); setLoadError(null); }
    catch (e) { setLoadError(errorMessage(e)); }
  }, [warehouseId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => { const t = document.documentElement.dataset.theme; setDark(t === "dark" || (t === "auto" && mq.matches)); };
    read();
    const mo = new MutationObserver(read); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    mq.addEventListener("change", read);
    return () => { mo.disconnect(); mq.removeEventListener("change", read); };
  }, []);

  const config = (mode === "config" && draft) || snap?.warehouse.config || readConfig(null);
  const lay = useMemo(() => layout(config), [config]);
  const floor = useMemo(() => grid(config, lay), [config, lay]);
  const k = useMemo(() => (snap ? kpis(snap) : null), [snap]);
  const prepId = snap?.staging.find((s) => s.code === "EMP-PREPARATION")?.id ?? null;
  const counts = useMemo(() => {
    const c = Object.fromEntries(GROUPS.map((g) => [g.id, 0])) as Record<Group, number>;
    if (snap) { for (const it of snap.items) if (it.loc) c[groupOf(it, prepId)]++; c.empty = Math.max(0, (k?.places ?? 0) - (k?.placed ?? 0)); }
    return c;
  }, [snap, prepId, k]);
  const heat = useMemo(() => (snap && heatRaw ? shelfHeat(snap, heatRaw, metric) : null), [snap, heatRaw, metric]);
  const start = useMemo<Pt>(() => {
    const z = config.zones.find((z) => z.kind === "shipping") ?? config.zones[0];
    return z ? { x: z.x + z.w / 2, z: z.z + 0.3 } : { x: config.room.length - 0.5, z: config.room.width - 0.5 };
  }, [config]);

  useEffect(() => {
    if (mode === "performance" && !heatRaw) rpc("warehouse_heat", { p_warehouse_id: warehouseId, p_days: 365 }).then((r) => setHeatRaw(readHeat(r))).catch((e) => toast(errorMessage(e), "error"));
    if (mode === "picking" && !queue) loadQueue();
    if (mode === "config" && !draft && snap) setDraft(snap.warehouse.config);
    if (!isManager && (metric === "value" || metric === "revenue" || metric === "margin")) setMetric("rotation");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ── where things are
  const slotBox = useCallback((it: WItem): Highlight | null => {
    if (!snap || !it.loc) return null;
    const lv = snap.levelById.get(it.loc); if (!lv) return null;
    const sh = lay.shelves.get(shelfKey(lv.rack, lv.shelf)); if (!sh) return null;
    const p = slotPoint(config, sh, lv.level, it.pos ?? 1), step = (config.shelf.width - 0.06) / config.shelf.perLevel;
    return { x: p.x, y: p.y + 0.12, z: p.z, w: sh.rot === 0 ? Math.max(0.08, step) : config.shelf.depth, h: 0.28, d: sh.rot === 0 ? config.shelf.depth : Math.max(0.08, step) };
  }, [snap, lay, config]);
  const shelfBox = (id: string): Highlight | null => {
    const s = lay.shelves.get(id); if (!s) return null;
    return { x: s.x, y: config.shelf.height / 2, z: s.z, w: s.rot === 0 ? config.shelf.width : config.shelf.depth, h: config.shelf.height + 0.05, d: s.rot === 0 ? config.shelf.depth : config.shelf.width };
  };
  const zoneOfItem = (it: WItem): Zone | null => {
    if (!snap || !it.loc) return null;
    const code = snap.stagingById.get(it.loc)?.code; if (!code) return null;
    return config.zones.find((z) => z.locations.includes(code)) ?? null;
  };
  const whereText = (it: WItem) => {
    const lv = it.loc ? snap?.levelById.get(it.loc) : null;
    if (lv) return `Rack ${lv.rack} → ${shelfKey(lv.rack, lv.shelf)} → L${lv.level}${it.pos ? ` · place ${it.pos}` : ""}`;
    const st = it.loc ? snap?.stagingById.get(it.loc) : null;
    if (st) return `${zoneOfItem(it)?.label ?? "Zone"} · ${st.label ?? st.code.replace("EMP-", "")}`;
    return "Sans emplacement";
  };

  // ── opening an item: its card, its place lit, the camera on it
  const openItem = useCallback(async (it: WItem, fly = true) => {
    setSel((s) => ({ ...s, item: it.id, zone: null, level: null, shelf: (() => { const lv = it.loc ? snap?.levelById.get(it.loc) : null; return lv ? shelfKey(lv.rack, lv.shelf) : null; })() }));
    const box = slotBox(it);
    setHighlight(box);
    const z = zoneOfItem(it);
    if (fly && box) scene.current?.focus({ x: box.x, y: box.y, z: box.z }, 3.2);
    else if (fly && z) scene.current?.focus({ x: z.x + z.w / 2, y: 0.8, z: z.z + z.d / 2 }, 6);
    setCard(null);
    try { setCard(await rpc<Card>("warehouse_item", { p_item_id: it.id })); } catch (e) { toast(errorMessage(e), "error"); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, slotBox, toast]);

  const search = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!snap) return;
    const s = q.trim().toUpperCase(); if (!s) return;
    const it = snap.itemBySku.get(s) ?? snap.items.find((i) => i.sku.toUpperCase().includes(s));
    if (!it) return toast(`${s} n'est pas dans le stock actuel (vendu et expédié, ou inconnu).`, "error");
    setPath(null);
    void openItem(it);
    if (!it.loc) toast(`${it.sku} n'a pas d'emplacement : rangez-le pour le retrouver ici.`, "error");
  };
  const suggestions = useMemo(() => {
    const s = q.trim().toUpperCase();
    if (!snap || s.length < 2) return [];
    return snap.items.filter((i) => i.sku.toUpperCase().includes(s)).slice(0, 6);
  }, [q, snap]);

  const showPath = (it: WItem) => {
    const lv = it.loc ? snap?.levelById.get(it.loc) : null;
    const sh = lv ? lay.shelves.get(shelfKey(lv.rack, lv.shelf)) : null;
    if (!sh) return toast("Pas d'étagère pour cet article : pas de chemin à montrer.", "error");
    const w = walk(floor, start, frontPoint(config, sh));
    if (!w) return toast("Cette étagère n'est pas accessible par les allées.", "error");
    setPath(w.path);
    toast(`Environ ${Math.round(w.length)} m depuis ${config.zones.find((z) => z.kind === "shipping")?.label ?? "l'entrée"}.`, "ok");
  };

  // ── clicks in 3D
  const onPick = (p: Pick) => {
    if (!snap) return;
    if (placing && p.kind === "level") return void place(placing, p.shelf, p.level);
    if (placing && p.kind === "zone") { const z = config.zones.find((z) => z.id === p.id); if (z?.locations[0]) return void moveTo(placing, z.locations[0]); }
    if (p.kind === "item") { const it = snap.items.find((i) => i.id === p.id); if (it) void openItem(it, false); return; }
    setCard(null); setPath(mode === "picking" ? path : null);
    if (p.kind === "level") { setSel({ shelf: p.shelf, level: p.level, item: null, zone: null }); setHighlight(shelfBox(p.shelf)); return; }
    if (p.kind === "zone") { setSel({ shelf: null, level: null, item: null, zone: p.id }); setHighlight(null); return; }
    setSel({ shelf: null, level: null, item: null, zone: null }); setHighlight(null);
  };
  const selectRack = (code: string) => {
    const r = lay.racks.find((r) => r.code === code); if (!r) return;
    const mid = r.shelves[Math.floor(r.shelves.length / 2)];
    setSel({ shelf: null, level: null, item: null, zone: null }); setCard(null);
    setHighlight({ x: r.rot === 0 ? r.x + r.length / 2 : mid.x, y: config.shelf.height / 2, z: r.rot === 0 ? mid.z : r.z + r.length / 2,
      w: r.rot === 0 ? r.length : config.shelf.depth, h: config.shelf.height + 0.05, d: r.rot === 0 ? config.shelf.depth : r.length });
    scene.current?.focus({ x: mid.x, y: 1, z: mid.z }, Math.max(6, r.length * 0.9));
  };
  const overview = () => { setSel({ shelf: null, level: null, item: null, zone: null }); setCard(null); setHighlight(null); setPath(null); scene.current?.overview(); };

  // ── moves (each one is written in the item's history by the database)
  const act = async (label: string, fn: () => Promise<unknown>, it?: WItem) => {
    setBusy(true);
    try { await fn(); toast(label, "ok"); await refresh(); if (it) { const fresh = await rpc<Card>("warehouse_item", { p_item_id: it.id }); setCard(fresh); } }
    catch (e) { toast(errorMessage(e), "error"); }
    finally { setBusy(false); }
  };
  const place = async (it: WItem, shelf: string, level: number) => {
    const lv = snap?.levelBySlot.get(`${shelf}-L${level}`);
    setPlacing(null);
    if (!lv) return toast(`Le niveau ${shelf}-L${level} n'existe pas encore : enregistrez la configuration.`, "error");
    await act(`${it.sku} rangé en ${levelId(lv.rack, lv.shelf, lv.level)}`, () => rpc("move_item", { p_item_id: it.id, p_location_code: lv.code, p_method: "manual" }), it);
  };
  const moveTo = async (it: WItem, code: string) => {
    setPlacing(null);
    await act(`${it.sku} déplacé : ${code.replace("EMP-", "")}`, () => rpc("move_item", { p_item_id: it.id, p_location_code: code, p_method: "manual" }), it);
  };

  // ── picking
  async function loadQueue() {
    try {
      const rows = await rpc<QueueRow[]>("shipping_queue", {});
      setQueue(rows);
      setChosen(new Set(rows.slice(0, 1).map((r) => r.order_id)));
    } catch (e) { toast(errorMessage(e), "error"); }
  }
  const orders = useMemo(() => {
    const m = new Map<string, { id: string; number: number; buyer: string | null; rows: QueueRow[] }>();
    for (const r of queue ?? []) (m.get(r.order_id) ?? m.set(r.order_id, { id: r.order_id, number: r.order_number, buyer: r.buyer_handle, rows: [] }).get(r.order_id)!).rows.push(r);
    return [...m.values()];
  }, [queue]);
  const startPicking = () => {
    if (!snap) return;
    const rows = (queue ?? []).filter((r) => chosen.has(r.order_id));
    const stops: Stop[] = [], off: QueueRow[] = [];
    for (const r of rows) {
      const lv = r.location_code ? snap.levelByCode.get(r.location_code) : null;
      const sh = lv ? lay.shelves.get(shelfKey(lv.rack, lv.shelf)) : null;
      const it = snap.items.find((i) => i.id === r.item_id);
      if (!lv || !sh || !it || r.item_status !== "sold") { off.push(r); continue; }
      stops.push({ item: r.item_id, sku: r.sku, order: r.order_number, at: frontPoint(config, sh), level: levelId(lv.rack, lv.shelf, lv.level),
        text: `${r.sku} → Rack ${lv.rack} → ${shelfKey(lv.rack, lv.shelf)} → L${lv.level}${it.pos ? ` · place ${it.pos}` : ""}`, done: false, highlight: slotBox(it) });
    }
    if (!stops.length) return toast(off.length ? "Ces articles ne sont pas sur une étagère (déjà préparés ou sans emplacement)." : "Choisissez au moins une commande.", "error");
    const r = route(floor, start, stops);
    const ordered = [...r.stops, ...r.unreachable];
    // one leg per stop, then the way back to the table
    const legs: Pt[][] = []; let from = start;
    for (const s of r.stops) { legs.push(walk(floor, from, s.at)?.path ?? []); from = s.at; }
    legs.push(walk(floor, from, start)?.path ?? []);
    setPick({ stops: ordered, legs, current: 0, off });
    setMode("picking");
    focusStop(ordered[0]);
  };
  const focusStop = (s?: Stop) => { if (!s) return; setHighlight(s.highlight); if (s.highlight) scene.current?.focus({ x: s.highlight.x, y: s.highlight.y, z: s.highlight.z }, 4); };
  const picked = async () => {
    if (!pick) return;
    const s = pick.stops[pick.current];
    setBusy(true);
    try {
      await rpc("pick_item", { p_item_id: s.item });
      const stops = pick.stops.map((x, i) => (i === pick.current ? { ...x, done: true } : x));
      const next = pick.current + 1;
      setPick({ ...pick, stops, current: next });
      toast(`${s.sku} récupéré`, "ok");
      if (next < stops.length) focusStop(stops[next]); else { setHighlight(null); scene.current?.focus({ x: start.x, y: 0.8, z: start.z }, 7); }
      void refresh();
    } catch (e) { toast(errorMessage(e), "error"); }
    finally { setBusy(false); }
  };
  const pickPath = useMemo(() => (pick ? pick.legs.flat() : null), [pick]);
  const pickDone = useMemo(() => (pick ? pick.legs.slice(0, pick.current).reduce((a, l) => a + l.length, 0) : 0), [pick]);
  const pickMarks = useMemo(() => (pick ? pick.stops.map((s, i) => ({ x: s.at.x, z: s.at.z, n: i + 1, done: s.done, current: i === pick.current })) : []), [pick]);

  // ── configuration
  const saveConfig = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const { error } = await supabaseBrowser().from("warehouses").update({ config: draft }).eq("id", warehouseId);
      if (error) throw error;
      const r = await rpc<{ created: number; adopted: number; archived: number; kept_not_empty: string[]; levels: number }>("warehouse_sync", { p_warehouse_id: warehouseId });
      toast(`Enregistré : ${num(r.levels)} niveaux${r.created ? `, ${r.created} créés` : ""}${r.adopted ? `, ${r.adopted} repris` : ""}${r.archived ? `, ${r.archived} retirés` : ""}.`, "ok");
      if (r.kept_not_empty.length) toast(`Gardés car non vides : ${r.kept_not_empty.slice(0, 5).map((c) => c.replace("EMP-", "")).join(", ")}${r.kept_not_empty.length > 5 ? "…" : ""}. Déplacez leurs articles.`, "error");
      await refresh(); setDraft(null); setMode("stock");
    } catch (e) { toast(errorMessage(e), "error"); }
    finally { setBusy(false); }
  };

  // ── what is shown in the side panel
  const selShelfLevels = useMemo(() => {
    if (!snap || !sel.shelf) return [];
    const [rack, n] = [sel.shelf.split("-")[0], Number(sel.shelf.split("-")[1])];
    return Array.from({ length: config.shelf.levels }, (_, i) => config.shelf.levels - i).map((lvn) => {
      const lv = snap.levelBySlot.get(`${sel.shelf}-L${lvn}`);
      const items = lv ? (snap.itemsByLoc.get(lv.id) ?? []).slice().sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0)) : [];
      return { id: levelId(rack, n, lvn), level: lvn, lv, items };
    });
  }, [snap, sel.shelf, config]);
  const zone = sel.zone ? config.zones.find((z) => z.id === sel.zone) ?? null : null;
  const zoneItems = useMemo(() => {
    if (!snap || !zone) return [];
    return zone.locations.map((code) => {
      const st = snap.staging.find((s) => s.code === code);
      return { code, label: st?.label ?? code.replace("EMP-", ""), items: st ? snap.itemsByLoc.get(st.id) ?? [] : [] };
    });
  }, [snap, zone]);
  const cap = capacity(config);

  if (loadError) return <p role="alert" className="rounded-xl bg-red-500/10 p-4 text-sm">{loadError}</p>;

  return (
    <div className="space-y-3" data-testid="warehouse">
      {/* ── header: name, figures */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <WarehouseIcon size={22} className="text-muted" aria-hidden />
          <h1 className="text-2xl font-bold tracking-[-0.03em]">Entrepôt 3D</h1>
          {warehouses.length > 1 && (
            <select className={`${input} !min-h-9 w-auto py-1 text-sm`} value={warehouseId} aria-label="Entrepôt"
              onChange={(e) => { window.location.href = `/entrepot?w=${e.target.value}`; }}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
        </div>
        <p className="text-xs text-muted">{num(config.room.length)} × {num(config.room.width)} m · {cap.racks} racks · {cap.shelves} étagères · {num(cap.places)} places</p>
      </div>
      <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6" data-testid="w-kpis">
        <Kpi k="Stock total" v={k ? num(k.stock) : "…"} />
        <Kpi k="Valeur stock" v={k ? (k.value == null ? "—" : eur(k.value)) : "…"} hint={k?.value == null ? "responsables" : "au prix d'achat"} />
        <Kpi k="Disponibles" v={k ? num(k.available) : "…"} />
        <Kpi k="À expédier" v={k ? num(k.toShip) : "…"} hint="commandes" />
        <Kpi k="Stock dormant" v={k ? num(k.dormant) : "…"} hint={snap ? `+ de ${snap.deadStockDays} j` : undefined} />
        <Kpi k="Rotation moyenne" v={k ? (k.rotationDays == null ? "—" : `${Math.round(k.rotationDays)} j`) : "…"} hint="médiane, 90 j" />
      </dl>

      {/* ── toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Mode" className={seg.wrap}>
          {([["stock", "Stock", MapPin], ["performance", "Performance", Flame], ["picking", "Picking", PackageCheck], ...(isManager ? [["config", "Configuration", Settings2]] : [])] as [Mode, string, typeof MapPin][]).map(([m, l, Icon]) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); if (m !== "picking") setPath(null); }}
              className={seg.item(mode === m)}>
              <Icon size={15} /> {l}
            </button>
          ))}
        </div>
        <form onSubmit={search} className="relative min-w-56 flex-1" role="search">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input className={`${input} pl-9 font-mono uppercase placeholder:font-sans placeholder:normal-case`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un SKU (ex. BLZ-00482)" aria-label="Rechercher un SKU" name="sku" autoComplete="off" />
          {suggestions.length > 0 && q.trim().toUpperCase() !== suggestions[0]?.sku.toUpperCase() && (
            <ul className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-line bg-panel shadow-xl">
              {suggestions.map((s) => (
                <li key={s.id}><button type="button" onClick={() => { setQ(s.sku); setPath(null); void openItem(s); }}
                  className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-sm hover:bg-fg/5">
                  <span className="font-mono">{s.sku}</span><span className="truncate text-xs text-muted">{whereText(s)}</span>
                </button></li>
              ))}
            </ul>
          )}
        </form>
        <div className="flex gap-1" role="group" aria-label="Caméra">
          <IconBtn label="Zoomer" onClick={() => scene.current?.zoom(0.7)}><Plus size={16} /></IconBtn>
          <IconBtn label="Dézoomer" onClick={() => scene.current?.zoom(1.4)}><Minus size={16} /></IconBtn>
          <button onClick={overview} className={btn.ghost} data-testid="overview"><Maximize2 size={15} /> Vue globale</button>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* ── the 3D view */}
        <div className="relative h-[60vh] min-h-[380px] overflow-hidden rounded-2xl border border-line xl:h-[calc(100dvh-300px)]">
          <Scene3D ref={scene} config={config} layout={lay} snap={snap} mode={mode} visible={visible} heat={mode === "performance" ? heat : null}
            selectedShelf={sel.shelf} selectedItem={sel.item} highlight={highlight} dark={dark} onPick={onPick}
            path={mode === "picking" && pick ? pickPath : path} pathDone={mode === "picking" ? pickDone : 0} stops={mode === "picking" ? pickMarks : []} />
          {!snap && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted"><Loader2 className="mr-2 animate-spin" size={16} /> Chargement du stock…</div>}
          {placing && (
            <div className="absolute inset-x-3 top-3 flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm text-white shadow-lg" role="status">
              <Crosshair size={16} /> Cliquez un niveau d&apos;étagère (ou une zone) pour y ranger <b className="font-mono">{placing.sku}</b>
              <button onClick={() => setPlacing(null)} className="ml-auto flex size-9 items-center justify-center rounded-lg hover:bg-white/15" aria-label="Annuler le rangement"><X size={16} /></button>
            </div>
          )}
          {/* legend: colour + letter + word, each one a filter */}
          <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1" aria-label="Légende et filtres" data-testid="legend">
            {mode === "performance" ? (
              <div className="flex items-center gap-2 rounded-lg bg-panel/90 px-2.5 py-1.5 text-xs shadow ring-1 ring-line backdrop-blur">
                <span className="h-2.5 w-24 rounded" style={{ background: `linear-gradient(90deg, ${ramp(0)}, ${ramp(1)})` }} aria-hidden />
                {METRICS.find((m) => m.id === metric)?.legend}
              </div>
            ) : GROUPS.map((g) => (
              <button key={g.id} onClick={() => setVisible((v) => { const n = new Set(v); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}
                aria-pressed={visible.has(g.id)} title={g.help} data-group={g.id}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-panel/90 px-2 text-xs shadow ring-1 ring-line backdrop-blur ${visible.has(g.id) ? "" : "opacity-45 line-through"}`}>
                <span className="flex size-4 items-center justify-center rounded text-[9px] font-bold text-white" style={{ background: config.colors[g.id] }} aria-hidden>{g.letter}</span>
                {g.label} <span className="figure tabular-nums text-muted">{num(counts[g.id] ?? 0)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── side panel */}
        <aside className="space-y-3" aria-label="Détails">
          {mode === "performance" && (
            <Panel title="Performance">
              <div className={`${seg.wrap} flex-wrap`} role="radiogroup" aria-label="Métrique">
                {METRICS.filter((m) => isManager || !m.money).map((m) => (
                  <button key={m.id} role="radio" aria-checked={metric === m.id} onClick={() => setMetric(m.id)}
                    className={seg.item(metric === m.id)}>{m.label}</button>
                ))}
              </div>
              {!heat ? <p className="mt-3 text-sm text-muted">Calcul…</p> : <HeatTop heat={heat} metric={metric} onOpen={(id) => { setCard(null); setSel({ shelf: id, level: null, item: null, zone: null }); setHighlight(shelfBox(id)); const s = lay.shelves.get(id); if (s) scene.current?.focus({ x: s.x, y: 1, z: s.z }, 5); }} />}
            </Panel>
          )}

          {mode === "picking" && (
            <Panel title="Picking" testid="picking">
              {!queue ? <p className="text-sm text-muted">Chargement des commandes…</p> : !pick ? (
                orders.length === 0 ? <p className="text-sm text-muted">Aucune commande à préparer.</p> : (
                  <>
                    <ul className="max-h-72 space-y-1 overflow-y-auto">
                      {orders.map((o) => (
                        <li key={o.id}>
                          <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-fg/5">
                            <input type="checkbox" className="mt-1 size-4" checked={chosen.has(o.id)} onChange={(e) => setChosen((c) => { const n = new Set(c); if (e.target.checked) n.add(o.id); else n.delete(o.id); return n; })} />
                            <span className="text-sm"><b>Commande V-{o.number}</b>{o.buyer ? ` · ${o.buyer}` : ""}<span className="block font-mono text-xs text-muted">{o.rows.map((r) => r.sku).join(", ")}</span></span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <button onClick={startPicking} disabled={!chosen.size} data-testid="start-picking"
                      className={`${btn.primary} mt-3 w-full uppercase tracking-wide`}>
                      <RouteIcon size={18} /> Démarrer le picking
                    </button>
                  </>
                )
              ) : (
                <>
                  <ol className="space-y-1" data-testid="pick-list">
                    {pick.stops.map((s, i) => (
                      <li key={s.item} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${i === pick.current ? "bg-accent/10 ring-1 ring-inset ring-accent/30" : ""}`} data-stop={s.sku} data-done={s.done || undefined}>
                        <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${s.done ? "bg-slate-500" : i === pick.current ? "bg-green-600" : "bg-indigo-600"}`}>{s.done ? <Check size={12} /> : i + 1}</span>
                        <span className={s.done ? "text-muted line-through" : ""}><span className="font-mono">{s.text}</span><span className="block text-xs text-muted">Commande V-{s.order}</span></span>
                      </li>
                    ))}
                  </ol>
                  {pick.off.length > 0 && <p className="mt-2 text-xs text-muted">Hors étagère : {pick.off.map((r) => `${r.sku} (${r.location_code?.replace("EMP-", "") ?? "sans emplacement"})`).join(", ")}</p>}
                  {pick.current < pick.stops.length ? (
                    <button onClick={picked} disabled={busy} data-testid="picked" className={`${btn.primary} mt-3 w-full`}>
                      <Check size={18} /> {pick.stops[pick.current].sku} récupéré
                    </button>
                  ) : (
                    <div className="mt-3 space-y-2" data-testid="pick-done">
                      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Tout est sur la table de préparation.</p>
                      <Link href="/postes/expedition" className={`${btn.secondary} w-full text-sm`}>Emballer et expédier <ArrowRight size={16} /></Link>
                    </div>
                  )}
                  <button onClick={() => { setPick(null); setHighlight(null); void loadQueue(); }} className="mt-2 min-h-11 w-full text-sm text-muted hover:text-fg">Nouvelle liste</button>
                </>
              )}
            </Panel>
          )}

          {mode === "config" && draft && (
            <ConfigPanel draft={draft} setDraft={setDraft} staging={snap?.staging.map((s) => s.code) ?? []} warnings={lay.warnings} busy={busy}
              onSave={saveConfig} onCancel={() => { setDraft(snap?.warehouse.config ?? null); setMode("stock"); }} />
          )}

          {card && (
            <ItemCard card={card} manager={isManager} busy={busy} where={(() => { const it = snap?.items.find((i) => i.id === card.id); return it ? whereText(it) : card.location?.code ?? "Sans emplacement"; })()}
              zones={config.zones} prepId={prepId}
              onClose={() => { setCard(null); setSel((s) => ({ ...s, item: null })); setHighlight(null); }}
              onNext={(to, label) => { const it = snap?.items.find((i) => i.id === card.id); return act(`${card.sku} : ${label}`, () => rpc("transition_item", { p_item_id: card.id, p_to: to, p_expected_version: card.version, p_station: "entrepot" }), it); }}
              onPlace={() => { const it = snap?.items.find((i) => i.id === card.id); if (it) { setPlacing(it); toast("Cliquez un niveau dans la vue 3D", "ok"); } }}
              onMoveTo={(code) => { const it = snap?.items.find((i) => i.id === card.id); if (it) void moveTo(it, code); }}
              onPick={() => { const it = snap?.items.find((i) => i.id === card.id); return act(`${card.sku} récupéré : sur la table de préparation`, () => rpc("pick_item", { p_item_id: card.id }), it); }}
              onPath={() => { const it = snap?.items.find((i) => i.id === card.id); if (it) showPath(it); }} />
          )}

          {!card && sel.shelf && mode !== "config" && (
            <Panel title={`Étagère ${sel.shelf}`} testid="shelf-panel" onClose={() => { setSel({ shelf: null, level: null, item: null, zone: null }); setHighlight(null); }}>
              {mode === "performance" && heat?.get(sel.shelf) && <HeatDetail h={heat.get(sel.shelf)!} manager={isManager} />}
              <ul className="space-y-2">
                {selShelfLevels.map((l) => (
                  <li key={l.id} className={`rounded-lg p-2 ring-1 ring-inset ${l.level === sel.level ? "ring-accent/40 bg-accent/5" : "ring-line"}`} data-level={l.id}>
                    <div className="flex items-baseline justify-between text-sm"><b className="font-mono">{l.id}</b>
                      <span className="text-xs text-muted">{l.lv ? `${l.items.length} / ${l.lv.capacity}` : "pas encore créé"}</span></div>
                    {l.items.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {l.items.map((it) => (
                          <button key={it.id} onClick={() => void openItem(it, true)} title={`${STATUS_LABEL[it.status]} · place ${it.pos ?? "?"}`}
                            className="inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 font-mono text-[11px] ring-1 ring-inset ring-line hover:ring-fg/40">
                            <span className="size-2 rounded-full" style={{ background: config.colors[groupOf(it, prepId)] }} aria-hidden />{it.sku}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {!card && zone && mode !== "config" && (
            <Panel title={zone.label} testid="zone-panel" onClose={() => setSel({ shelf: null, level: null, item: null, zone: null })}>
              {zone.kind === "photo" && zone.features && (
                <p className="mb-2 text-xs text-muted">Équipement : {[zone.features.backdrop && "fond photo", zone.features.table && "table", zone.features.lights && "éclairage", zone.features.mannequin && "mannequin", zone.features.measure && "zone de mesures"].filter(Boolean).join(", ") || "aucun"}</p>
              )}
              {zoneItems.map((g) => (
                <div key={g.code} className="mb-2">
                  <div className="flex items-baseline justify-between text-sm"><b>{g.label}</b><span className="text-xs text-muted">{g.items.length}</span></div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {g.items.slice(0, 60).map((it) => (
                      <button key={it.id} onClick={() => void openItem(it, false)} className="min-h-8 rounded-md px-1.5 font-mono text-[11px] ring-1 ring-inset ring-line hover:ring-fg/40">{it.sku}</button>
                    ))}
                    {g.items.length > 60 && <span className="text-xs text-muted">+ {g.items.length - 60}</span>}
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted">Le flux : Réception → Tri → Photos → Mesures → Listing → Stockage. Chaque passage est enregistré dans l&apos;historique de l&apos;article.</p>
            </Panel>
          )}

          {!card && !sel.shelf && !zone && mode === "stock" && (
            <Panel title="Racks">
              <div className="flex flex-wrap gap-1.5">
                {lay.racks.map((r) => (
                  <button key={r.code} onClick={() => selectRack(r.code)} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-semibold ring-1 ring-inset ring-line hover:ring-fg/40" data-rack={r.code}>
                    RACK {r.code}<span className="text-xs font-normal text-muted">{r.shelves.length}</span>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted">Cliquez un rack, une étagère ou une zone dans la vue ; tournez avec la souris ou un doigt, déplacez avec clic droit ou deux doigts, zoomez avec la molette.</p>
              {k && k.unplaced > 0 && <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">{num(k.unplaced)} article{k.unplaced > 1 ? "s" : ""} sans emplacement : recherchez-les et « Ranger ».</p>}
              {lay.warnings.map((w) => <p key={w} className="mt-2 text-xs text-amber-800 dark:text-amber-300">{w}</p>)}
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

function Kpi({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel/80 px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</dt>
      <dd className="figure text-lg font-semibold tabular-nums sm:text-xl">{v}</dd>
      {hint && <dd className="text-[11px] text-muted">{hint}</dd>}
    </div>
  );
}
function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} aria-label={label} title={label} className={btn.icon}>{children}</button>;
}
function Panel({ title, children, onClose, testid }: { title: string; children: React.ReactNode; onClose?: () => void; testid?: string }) {
  return (
    <section className="rounded-2xl border border-line bg-panel/80 p-4 shadow-[0_1px_0_0_rgb(255_255_255/0.03)_inset]" data-testid={testid}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="section-title">{title}</h2>
        {onClose && <button onClick={onClose} aria-label="Fermer" className="flex size-9 items-center justify-center rounded-lg text-muted hover:text-fg"><X size={16} /></button>}
      </div>
      {children}
    </section>
  );
}

function ItemCard({ card, manager, busy, where, zones, prepId, onClose, onNext, onPlace, onMoveTo, onPick, onPath }: {
  card: Card; manager: boolean; busy: boolean; where: string; zones: Zone[]; prepId: string | null;
  onClose: () => void; onNext: (to: ItemStatus, label: string) => void; onPlace: () => void; onMoveTo: (code: string) => void; onPick: () => void; onPath: () => void;
}) {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    setPhoto(null);
    if (card.photo) supabaseBrowser().storage.from("item-photos").createSignedUrl(card.photo, 3600).then(({ data }: { data: { signedUrl: string } | null }) => setPhoto(data?.signedUrl ?? null));
  }, [card.photo]);
  const price = card.sold_cents ?? card.price_cents;
  const margin = manager && card.cost_cents != null && price != null ? price - card.cost_cents : null;
  const next = NEXT[card.status];
  const onShelf = card.location?.level_no != null;
  const zoneCodes = [...new Set(zones.flatMap((z) => z.locations))].filter((c) => c !== card.location?.code);
  return (
    <Panel title={card.sku} testid="item-card" onClose={onClose}>
      <div className="flex gap-3">
        <div className="size-24 shrink-0 overflow-hidden rounded-xl bg-fg/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photo ? <img src={photo} alt={`Photo ${card.sku}`} className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-xs text-muted">Pas de photo</div>}
        </div>
        <div className="min-w-0 text-sm">
          <div className="truncate font-medium">{card.title ?? [card.brand, card.category].filter(Boolean).join(" · ") ?? "—"}</div>
          <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-fg/5 px-2 py-0.5 text-xs" data-status={card.status}>{STATUS_LABEL[card.status]}</div>
          <div className="mt-1 text-xs text-muted" data-testid="item-where"><MapPin size={12} className="mr-1 inline" />{where}</div>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <Row k="Marque" v={card.brand} /><Row k="Catégorie" v={card.category} /><Row k="Taille" v={card.size} /><Row k="Couleur" v={card.color} />
        {manager && <Row k="Prix d'achat" v={eur(card.cost_cents)} />}
        <Row k={card.sold_cents != null ? "Vendu" : "Prix de vente"} v={eur(price)} />
        {manager && <Row k="Marge" v={margin == null ? "—" : eur(margin)} />}
        <Row k="Plateforme" v={card.platform ? card.platform[0].toUpperCase() + card.platform.slice(1) : null} />
        <Row k="Entré en stock" v={day(card.received_at)} /><Row k="Mis en ligne" v={day(card.listed_at)} />
        <Row k="Favoris" v={card.favourites == null ? null : num(card.favourites)} /><Row k="Vues" v={card.views == null ? null : num(card.views)} />
      </dl>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {next && <ActBtn onClick={() => onNext(next.to, next.label)} disabled={busy} primary>Étape suivante : {next.label}</ActBtn>}
        {card.status === "listing_ready" && <Link href={`/stock/${encodeURIComponent(card.sku)}`} className={btn.sm}>Publier <ExternalLink size={14} /></Link>}
        {card.status === "sold" && card.location?.id !== prepId && <ActBtn onClick={onPick} disabled={busy} primary>Récupéré (préparation)</ActBtn>}
        {!["sold", "shipped", "completed"].includes(card.status) && <ActBtn onClick={onPlace} disabled={busy}>Ranger sur une étagère…</ActBtn>}
        {onShelf && <ActBtn onClick={onPath} disabled={busy}><RouteIcon size={14} /> Chemin</ActBtn>}
        {zoneCodes.length > 0 && !["shipped", "completed"].includes(card.status) && (
          <select className={`${input} !min-h-10 w-auto py-1 text-sm`} value="" aria-label="Déplacer vers une zone" disabled={busy}
            onChange={(e) => e.target.value && onMoveTo(e.target.value)}>
            <option value="">Déplacer vers une zone…</option>
            {zoneCodes.map((c) => <option key={c} value={c}>{c.replace("EMP-", "")}</option>)}
          </select>
        )}
        <Link href={`/stock/${encodeURIComponent(card.sku)}`} className={`${btn.ghost} text-muted hover:text-fg`}>Fiche complète <ChevronRight size={14} /></Link>
      </div>

      <details className="mt-3" open>
        <summary className="min-h-9 cursor-pointer text-sm font-medium">Historique des mouvements</summary>
        <ol className="mt-1 max-h-56 space-y-1 overflow-y-auto text-xs" data-testid="item-history">
          {card.history.map((h, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 tabular-nums text-muted">{new Date(h.at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              <span>{h.kind === "move"
                ? <>Déplacé {h.from ? <>de <b className="font-mono">{h.from.replace("EMP-", "")}</b> </> : null}vers <b className="font-mono">{h.to?.replace("EMP-", "")}</b></>
                : h.type && EVENT_LABEL[h.type] ? <>{EVENT_LABEL[h.type]}</>
                : <>{h.from ? `${STATUS_LABEL[h.from as ItemStatus] ?? h.from} → ` : ""}{STATUS_LABEL[h.to as ItemStatus] ?? h.to}</>}
                {h.by && <span className="text-muted"> · {h.by}</span>}</span>
            </li>
          ))}
        </ol>
      </details>
    </Panel>
  );
}
/** Events of the item that are not a change of step */
const EVENT_LABEL: Record<string, string> = {
  picked: "Récupéré pour la préparation", priority: "Priorité modifiée", block: "Signalé (problème)", start: "Pris en charge à un poste",
  imported: "Importé", deleted: "Mis à la corbeille", restored: "Restauré", sale_voided: "Vente annulée",
};
const Row = ({ k, v }: { k: string; v: string | null | undefined }) => (<><dt className="text-muted">{k}</dt><dd className="truncate text-right">{v ?? "—"}</dd></>);
function ActBtn({ children, onClick, disabled, primary }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return <button onClick={onClick} disabled={disabled} className={primary ? btn.sm : btn.ghost}>{children}</button>;
}

function HeatTop({ heat, metric, onOpen }: { heat: Map<string, import("@/lib/warehouse3d/model").ShelfHeat>; metric: Metric; onOpen: (id: string) => void }) {
  const list = [...heat.values()].filter((h) => h.t != null).sort((a, b) => (b.t ?? 0) - (a.t ?? 0)).slice(0, 8);
  const fmt = (v: number | null) => v == null ? "—" : metric === "rotation" ? `${Math.round(v)} j` : metric === "dormant" ? num(v) : eur(v);
  return (
    <ol className="mt-3 space-y-1" data-testid="heat-top">
      {list.length === 0 && <li className="text-sm text-muted">Pas encore de données pour cette métrique.</li>}
      {list.map((h, i) => (
        <li key={h.shelf}><button onClick={() => onOpen(h.shelf)} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-fg/5">
          <span className="w-4 text-xs text-muted">{i + 1}</span><span className="size-3 rounded" style={{ background: ramp(h.t) }} aria-hidden />
          <span className="font-mono">{h.shelf}</span><span className="ml-auto figure tabular-nums">{fmt(h.raw)}</span>
        </button></li>
      ))}
    </ol>
  );
}
function HeatDetail({ h, manager }: { h: import("@/lib/warehouse3d/model").ShelfHeat; manager: boolean }) {
  const d = h.detail;
  return (
    <dl className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm" data-testid="heat-detail">
      <dt className="text-muted">Articles</dt><dd className="text-right">{num(d.items)}</dd>
      {manager && <><dt className="text-muted">Valeur du stock</dt><dd className="text-right">{eur(d.valueCents)}</dd></>}
      {manager && <><dt className="text-muted">CA (12 mois)</dt><dd className="text-right">{eur(d.revenueCents)}</dd></>}
      {manager && <><dt className="text-muted">Marge (12 mois)</dt><dd className="text-right">{eur(d.marginCents)}</dd></>}
      <dt className="text-muted">Délai de vente</dt><dd className="text-right">{d.daysToSell == null ? "—" : `${Math.round(d.daysToSell)} j`}</dd>
      <dt className="text-muted">Ancienneté moyenne</dt><dd className="text-right">{d.avgAge == null ? "—" : `${Math.round(d.avgAge)} j`}</dd>
      <dt className="text-muted">Dormants</dt><dd className="text-right">{num(d.dormant)}</dd>
    </dl>
  );
}

function ConfigPanel({ draft, setDraft, staging, warnings, busy, onSave, onCancel }: {
  draft: WarehouseConfig; setDraft: (c: WarehouseConfig) => void; staging: string[]; warnings: string[]; busy: boolean; onSave: () => void; onCancel: () => void;
}) {
  const set = (path: string, v: number) => {
    const n = structuredClone(draft) as unknown as Record<string, Record<string, number>>;
    const [a, b] = path.split(".");
    if (b) n[a][b] = v; else (n as unknown as Record<string, number>)[a] = v;
    setDraft(readConfig(n));
  };
  const nf = (label: string, path: string, value: number, step = 0.1) => (
    <label className="text-sm"><span className="mb-0.5 block text-xs text-muted">{label}</span>
      <NumField value={value} step={step} name={`cfg-${path}`} onValue={(v) => set(path, v)} /></label>
  );
  const cap = capacity(draft);
  const shelvesPer = draft.racks[0]?.shelves ?? 1;
  const zone = (i: number, patch: Partial<Zone>) => setDraft(readConfig({ ...draft, zones: draft.zones.map((z, j) => (j === i ? { ...z, ...patch } : z)) }));
  return (
    <Panel title="Configuration" testid="config-panel">
      <p className="mb-2 text-xs text-muted">Aperçu en direct. Rien n&apos;est changé dans le stock avant « Enregistrer » ; les emplacements existants sont repris, jamais dupliqués.</p>
      <fieldset className="grid grid-cols-3 gap-2"><legend className="mb-1 text-sm font-semibold">Local</legend>
        {nf("Longueur (m)", "room.length", draft.room.length, 0.5)}{nf("Largeur (m)", "room.width", draft.room.width, 0.5)}{nf("Hauteur (m)", "room.height", draft.room.height, 0.1)}
      </fieldset>
      <p className="mt-1 text-xs text-muted">{num(draft.room.length * draft.room.width)} m²</p>
      <fieldset className="mt-3 grid grid-cols-3 gap-2"><legend className="mb-1 text-sm font-semibold">Racks</legend>
        <label className="text-sm"><span className="mb-0.5 block text-xs text-muted">Nombre</span>
          <NumField value={draft.racks.length} step={1} name="cfg-racks" onValue={(v) => setDraft(withRacks(draft, Math.round(v), shelvesPer))} /></label>
        <label className="text-sm"><span className="mb-0.5 block text-xs text-muted">Étagères / rack</span>
          <NumField value={shelvesPer} step={1} name="cfg-shelves" onValue={(v) => setDraft(withRacks(draft, draft.racks.length, Math.round(v)))} /></label>
        {nf("Allée (m)", "aisle", draft.aisle, 0.1)}
      </fieldset>
      <fieldset className="mt-3 grid grid-cols-3 gap-2"><legend className="mb-1 text-sm font-semibold">Étagère</legend>
        {nf("Largeur (m)", "shelf.width", draft.shelf.width, 0.05)}{nf("Profondeur (m)", "shelf.depth", draft.shelf.depth, 0.05)}{nf("Hauteur (m)", "shelf.height", draft.shelf.height, 0.05)}
        {nf("Niveaux", "shelf.levels", draft.shelf.levels, 1)}{nf("Articles / niveau", "shelf.perLevel", draft.shelf.perLevel, 1)}
      </fieldset>
      <p className="mt-2 text-sm" data-testid="cfg-capacity"><b>{cap.shelves}</b> étagères · <b>{num(cap.perShelf)}</b> par étagère · capacité <b>{num(cap.places)}</b> articles</p>
      {warnings.map((w) => <p key={w} className="mt-1 text-xs text-amber-800 dark:text-amber-300">{w}</p>)}

      <details className="mt-3"><summary className="min-h-10 cursor-pointer text-sm font-semibold">Zones de travail ({draft.zones.length})</summary>
        <div className="mt-2 space-y-3">
          {draft.zones.map((z, i) => (
            <div key={z.id} className="rounded-lg p-2 ring-1 ring-inset ring-line">
              <input className={`${input} !min-h-9 py-1 text-sm font-medium`} value={z.label} aria-label="Nom de la zone" onChange={(e) => zone(i, { label: e.target.value })} />
              <div className="mt-1 grid grid-cols-4 gap-1">
                {(["x", "z", "w", "d"] as const).map((key) => (
                  <label key={key} className="text-xs"><span className="text-muted">{{ x: "X", z: "Y", w: "Long.", d: "Larg." }[key]}</span>
                    <NumField small value={z[key]} step={0.5} onValue={(v) => zone(i, { [key]: v } as Partial<Zone>)} /></label>
                ))}
              </div>
              {z.kind === "photo" && z.features && (
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                  {(["backdrop", "table", "lights", "mannequin", "measure"] as const).map((f) => (
                    <label key={f} className="flex min-h-9 items-center gap-1"><input type="checkbox" checked={z.features![f]} onChange={(e) => zone(i, { features: { ...z.features!, [f]: e.target.checked } })} />
                      {{ backdrop: "Fond", table: "Table", lights: "Éclairage", mannequin: "Mannequin", measure: "Mesures" }[f]}</label>
                  ))}
                </div>
              )}
              <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                {staging.map((code) => (
                  <label key={code} className="flex min-h-8 items-center gap-1"><input type="checkbox" checked={z.locations.includes(code)}
                    onChange={(e) => zone(i, { locations: e.target.checked ? [...z.locations, code] : z.locations.filter((c) => c !== code) })} />{code.replace("EMP-", "")}</label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>
      <details className="mt-2"><summary className="min-h-10 cursor-pointer text-sm font-semibold">Couleurs des statuts</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {GROUPS.map((g) => (
            <label key={g.id} className="flex min-h-10 items-center gap-2 text-sm"><input type="color" value={draft.colors[g.id]} aria-label={`Couleur : ${g.label}`}
              onChange={(e) => setDraft(readConfig({ ...draft, colors: { ...draft.colors, [g.id]: e.target.value } }))} />{g.label}</label>
          ))}
        </div>
      </details>
      <div className="mt-4 flex gap-2">
        <button onClick={onSave} disabled={busy} data-testid="cfg-save" className={`${btn.primary} flex-1`}>Enregistrer et appliquer</button>
        <button onClick={onCancel} className={btn.secondary}>Annuler</button>
      </div>
    </Panel>
  );
}

/** A number typed freely: applied as soon as it is a positive number, shown again as stored when the field is left */
function NumField({ value, step, name, small, onValue }: { value: number; step: number; name?: string; small?: boolean; onValue: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(String(value)); }, [value, focus]);
  return (
    <input className={`${input} ${small ? "!min-h-9 py-1 text-xs" : "!min-h-10"} text-right font-mono`} type="number" inputMode="decimal" step={step} min={0} name={name}
      value={text} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      onChange={(e) => { setText(e.target.value); const v = Number(e.target.value.replace(",", ".")); if (e.target.value !== "" && Number.isFinite(v) && v > 0) onValue(v); }} />
  );
}
