"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Camera, Package, Search, ShoppingBag, Zap } from "lucide-react";
import { StatusChip } from "./ui";
import { useToast } from "./toast";
import { parseCommand, type Command } from "@/lib/commands";
import { moveTo, restorePrice, restoreStatuses, setPrice, setStatus } from "@/lib/item-edits";
import { NAV, SHORTCUTS, fold } from "@/lib/nav";
import { classifyScan } from "@/lib/scan";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money } from "@/lib/format";
import { STATUS_LABEL } from "@/i18n/fr";
import { REPEAT_LABEL, dueLabel, parisToday, parseQuick } from "@/lib/todos";
import type { ItemStatus } from "@/lib/types";

// ⌘K / "/" palette: search items by title, brand, size or SKU, sales by number, and jump to any page.
// A typed or scanned code (SKU, EMP-, LOT-) still goes to the current screen first, as before.

type Result =
  | { kind: "action"; key: string; label: string; meta: string; run: () => Promise<void> }
  | { kind: "item"; key: string; href: string; sku: string; title: string; status: ItemStatus; price: number | null; meta: string }
  | { kind: "order"; key: string; href: string; label: string; meta: string }
  | { kind: "page"; key: string; href: string; label: string };

type Target = { id: string; sku: string; status: ItemStatus; list_price_cents: number | null; min_price_cents: number | null; locations: { code: string } | null };
type ItemRow = { sku: string; title: string | null; status: ItemStatus; size_label: string | null; list_price_cents: number | null; brands: { name: string } | null };

export function Palette({ isManager, onCode, onCamera, onClose }: {
  isManager: boolean; onCode: (code: string) => void; onCamera: () => void; onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState("");
  const [action, setAction] = useState<Result | null>(null);
  const [items, setItems] = useState<Result[]>([]);
  const [orders, setOrders] = useState<Result[]>([]);
  const [cursor, setCursor] = useState(-1);
  const q = value.trim();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pages = useMemo<Result[]>(() => {
    // a hub's menu entry (Rotation, Mon argent) is a door to its tabs: the tabs themselves are what people search for
    // a hub's menu entry and its first tab share a page: list it once
    const visible = NAV.filter((n) => !n.match && (isManager || !n.manager));
    const pages = visible.filter((n, i) => visible.findIndex((m) => m.href === n.href) === i);
    const all = [...pages, ...SHORTCUTS].filter((p) => isManager || !p.manager);
    const words = fold(q).split(/\s+/).filter(Boolean);
    const list = words.length
      ? all.filter((p) => words.every((w) => fold(`${p.label} ${"keywords" in p ? p.keywords ?? "" : ""}`).includes(w)))
      : all.slice(0, 6);
    return list.slice(0, 5).map((p) => ({ kind: "page", key: `p:${p.href}`, href: p.href, label: p.label }));
  }, [q, isManager]);

  // A typed command (« M-12 29 », « ranger M-5 en A-01-02 », « vendre M-12 »…) becomes the first result
  useEffect(() => {
    const cmd = parseCommand(q);
    if (!cmd) { setAction(null); return; }
    if (cmd.kind === "todo") { setAction(describeTodo(cmd.text)); return; }
    let live = true;
    const t = setTimeout(async () => {
      const { data } = await supabaseBrowser().from("items")
        .select("id, sku, status, list_price_cents, min_price_cents, locations(code)").eq("sku", cmd.sku).is("deleted_at", null).maybeSingle();
      if (!live) return;
      setAction(data ? describe(cmd, data as unknown as Target) : { kind: "action", key: "a:none", label: `${cmd.sku} introuvable`, meta: "Vérifiez le SKU", run: async () => {} });
    }, 120);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function describeTodo(text: string): Result {
    const today = parisToday();
    const t = parseQuick(text, today);
    const meta = [t.due_on ? dueLabel(t.due_on, today) : "sans date", t.repeat !== "none" && REPEAT_LABEL[t.repeat].toLowerCase(), t.important && "important"]
      .filter(Boolean).join(" · ");
    return { kind: "action", key: "a:todo", label: `Ajouter la tâche « ${t.title} »`, meta, run: async () => {
      if (!t.title) return;
      const db = supabaseBrowser();
      const { data, error } = await db.from("todos").insert({ title: t.title, due_on: t.due_on, repeat: t.repeat, important: t.important }).select("id").single();
      if (error) return toast(error.message, "error");
      toast(`Tâche ajoutée : ${t.title}`, "ok", { action: { label: "Annuler", run: async () => {
        await db.from("todos").delete().eq("id", data.id);
        toast("Tâche retirée", "info");
        router.refresh();
      } } });
      router.refresh();
    } };
  }

  function describe(cmd: Exclude<Command, { kind: "todo" }>, it: Target): Result {
    const sold = ["sold", "shipped", "completed"].includes(it.status);
    const done = (text: string, undo?: () => Promise<unknown>) => {
      toast(text, "ok", undo ? { action: { label: "Annuler", run: async () => {
        try {
          const refused = ((await undo()) as { errors?: { sku: string; error: string }[] } | undefined)?.errors ?? [];
          toast(refused.length ? `Impossible d'annuler : ${refused.map((x) => x.error).join(", ")}` : "Modification annulée", refused.length ? "error" : "info");
        } catch (e) { toast(`Impossible d'annuler : ${(e as Error).message}`, "error"); }
        router.refresh();
      } } } : undefined);
      router.refresh();
    };
    const fail = (e: unknown) => toast((e as Error).message, "error");
    const base = { kind: "action" as const, key: `a:${cmd.kind}:${it.sku}` };
    switch (cmd.kind) {
      case "price":
        return { ...base, label: `Mettre ${it.sku} à ${money(cmd.cents)}`, meta: sold ? "Article vendu : prix non modifiable" : `actuellement ${money(it.list_price_cents)}`,
          run: async () => {
            if (sold) return toast(`${it.sku} est vendu : son prix ne change plus`, "error");
            try { await setPrice(it.id, cmd.cents, it.min_price_cents); done(`${it.sku} : ${money(it.list_price_cents)} → ${money(cmd.cents)}`, () => restorePrice(it.id, it.list_price_cents, it.min_price_cents)); }
            catch (e) { fail(e); }
          } };
      case "move":
        return { ...base, label: `Ranger ${it.sku} en ${cmd.location.replace("EMP-", "")}`, meta: `actuellement ${it.locations?.code.replace("EMP-", "") ?? "aucun emplacement"}`,
          run: async () => {
            try { await moveTo(it.id, cmd.location); done(`${it.sku} rangé en ${cmd.location.replace("EMP-", "")}`, it.locations ? () => moveTo(it.id, it.locations!.code) : undefined); }
            catch (e) { fail(e); }
          } };
      case "list":
        return { ...base, label: `Mettre ${it.sku} en ligne`, meta: `statut actuel : ${it.status === "listed" ? "déjà en ligne" : STATUS_LABEL[it.status].toLowerCase()}`,
          run: async () => {
            try {
              const r = await setStatus([it.id], "listed");
              if (r.errors.length) return toast(r.errors[0].error, "error");
              done(`${it.sku} mis en ligne`, () => restoreStatuses([{ id: it.id, status: it.status }]));
            } catch (e) { fail(e); }
          } };
      case "sell":
        return { ...base, label: `Enregistrer la vente de ${it.sku}`, meta: money(it.list_price_cents), run: async () => router.push(`/ventes?article=${encodeURIComponent(it.sku)}`) };
      case "label":
        return { ...base, label: `Imprimer l'étiquette de ${it.sku}`, meta: "nouvel onglet", run: async () => { let format = "4x6-max";
            try { format = localStorage.getItem("labelFormat") || format; } catch {}
            window.open(`/etiquettes/articles?skus=${encodeURIComponent(it.sku)}&format=${format}`, "_blank"); } };
    }
  }

  useEffect(() => {
    const text = q.replace(/[%,()*]/g, " ").trim();
    if (text.length < 2) { setItems([]); setOrders([]); return; }
    const t = setTimeout(async () => {
      const db = supabaseBrowser();
      const words = text.split(/\s+/).filter(Boolean);
      const { data: brands } = await db.from("brands").select("id, name").or(words.map((w) => `name.ilike.%${w}%`).join(","));
      let query = db.from("items").select("sku, title, status, size_label, list_price_cents, brands(name)").is("deleted_at", null);
      for (const w of words) {
        const ids = ((brands ?? []) as { id: string; name: string }[]).filter((b) => fold(b.name).includes(fold(w))).map((b) => b.id);
        query = query.or(`title.ilike.%${w}%,sku.ilike.%${w}%,size_label.ilike.${w}${ids.length ? `,brand_id.in.(${ids.join(",")})` : ""}`);
      }
      const num = isManager ? text.match(/^v?-?\s*(\d{1,6})$/i)?.[1] : undefined;
      const [{ data }, ordersRes] = await Promise.all([
        query.order("status_changed_at", { ascending: false }).limit(7),
        num ? db.from("orders").select("number, status, buyer_handle, gross_cents").eq("number", Number(num)).limit(1) : Promise.resolve({ data: [] }),
      ]);
      setItems(((data ?? []) as unknown as ItemRow[]).map((r) => ({
        kind: "item", key: `i:${r.sku}`, href: `/stock/${r.sku}`, sku: r.sku, title: r.title ?? r.brands?.name ?? "Sans titre",
        status: r.status, price: r.list_price_cents,
        meta: [r.size_label && `taille ${r.size_label}`, r.brands?.name].filter(Boolean).join(" · "),
      })));
      setOrders(((ordersRes.data ?? []) as { number: number; buyer_handle: string | null; gross_cents: number }[]).map((o) => ({
        kind: "order", key: `o:${o.number}`, href: `/ventes?q=V-${o.number}`, label: `Vente V-${o.number}`,
        meta: [o.buyer_handle, money(o.gross_cents)].filter(Boolean).join(" · "),
      })));
    }, 160);
    return () => clearTimeout(t);
  }, [q, isManager]);

  const results = [...(action ? [action] : []), ...orders, ...items, ...pages];
  useEffect(() => setCursor(-1), [q]);

  function open(r: Result) {
    onClose();
    if (r.kind === "action") { r.run(); return; }
    router.push(r.href);
  }
  function submit() {
    if (cursor >= 0 && results[cursor]) return open(results[cursor]);
    // a recognised command runs on Enter
    if (action && action.key !== "a:none") return open(action);
    // a code goes to the current screen (stations consume scans); free text opens the best match
    if (q && classifyScan(q).kind !== "unknown") return onCode(q);
    if (results[0] && q) return open(results[0]);
    if (q) onCode(q);
  }

  const section = (title: string, list: Result[], offset: number) => list.length > 0 && (
    <div>
      <div className="eyebrow px-4 pb-1 pt-3 text-muted">{title}</div>
      <ul role="listbox">
        {list.map((r, i) => {
          const idx = offset + i;
          return (
            <li key={r.key} role="option" aria-selected={idx === cursor}>
              <button type="button" onMouseEnter={() => setCursor(idx)} onClick={() => open(r)}
                className={`flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left ${idx === cursor ? "bg-fg/6" : ""}`}>
                {r.kind === "action" ? (
                  <>
                    <Zap size={18} className="shrink-0 text-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{r.label}</span>
                      <span className="block truncate text-xs text-muted">{r.meta}</span>
                    </span>
                    <kbd className="hidden rounded border border-line px-1.5 font-mono text-[10px] text-muted sm:block">Entrée</kbd>
                  </>
                ) : r.kind === "item" ? (
                  <>
                    <Package size={18} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.title}</span>
                      <span className="block truncate text-xs text-muted"><span className="font-mono">{r.sku}</span>{r.meta && ` · ${r.meta}`}</span>
                    </span>
                    <StatusChip status={r.status} />
                    <span className="hidden w-16 text-right text-sm tabular-nums sm:block">{money(r.price)}</span>
                  </>
                ) : r.kind === "order" ? (
                  <>
                    <ShoppingBag size={18} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 text-sm font-medium">{r.label}<span className="ml-2 text-xs text-muted">{r.meta}</span></span>
                  </>
                ) : (
                  <>
                    <ArrowRight size={18} className="shrink-0 text-muted" />
                    <span className="flex-1 text-sm">{r.label}</span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-3 pt-[max(3.5rem,env(safe-area-inset-top))] backdrop-blur-sm" onClick={onClose}>
      <form role="dialog" aria-label="Rechercher" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="flex max-h-[80dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={20} className="shrink-0 text-muted" />
          <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" spellCheck={false}
            role="combobox" aria-expanded={results.length > 0} aria-controls="palette-results" aria-autocomplete="list"
            placeholder="Article, marque, SKU, V-123, page…"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && results.length) { e.preventDefault(); setCursor((c) => (c + 1) % results.length); }
              if (e.key === "ArrowUp" && results.length) { e.preventDefault(); setCursor((c) => (c <= 0 ? results.length - 1 : c - 1)); }
            }}
            className="min-h-14 w-full bg-transparent text-lg outline-none placeholder:text-muted/60" />
          <button type="button" onClick={onCamera} aria-label="Scanner avec la caméra"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line text-muted hover:text-fg"><Camera size={18} /></button>
        </div>
        <div id="palette-results" className="overflow-y-auto pb-2">
          {action && section("Action", [action], 0)}
          {section("Ventes", orders, action ? 1 : 0)}
          {section("Articles", items, (action ? 1 : 0) + orders.length)}
          {section(q ? "Pages" : "Aller à", pages, (action ? 1 : 0) + orders.length + items.length)}
          {!q && (
            <p className="px-4 pt-3 text-xs text-muted">
              Vous pouvez aussi agir : <span className="font-mono text-fg/80">M-12 29</span> (prix), <span className="font-mono text-fg/80">ranger M-5 en A-01-02</span>,{" "}
              <span className="font-mono text-fg/80">vendre M-12</span>, <span className="font-mono text-fg/80">en ligne M-12</span>, <span className="font-mono text-fg/80">étiquette M-12</span>,{" "}
              <span className="font-mono text-fg/80">tâche Appeler le fournisseur demain</span>.
            </p>
          )}
          {q.length >= 2 && !items.length && !orders.length && !pages.length && (
            <p className="px-4 py-6 text-center text-sm text-muted">Rien trouvé. Entrée pour ouvrir le code « {q.toUpperCase()} ».</p>
          )}
        </div>
        <div className="hidden items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-muted sm:flex">
          <span><kbd className="font-mono">↑↓</kbd> choisir</span><span><kbd className="font-mono">Entrée</kbd> ouvrir</span>
          <span><kbd className="font-mono">Échap</kbd> fermer</span>
          <span className="ml-auto">Une douchette fonctionne depuis n&apos;importe quel écran.</span>
        </div>
      </form>
    </div>
  );
}
