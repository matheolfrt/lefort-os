"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Camera, Package, Search, ShoppingBag } from "lucide-react";
import { StatusChip } from "./ui";
import { NAV, SHORTCUTS, fold } from "@/lib/nav";
import { classifyScan } from "@/lib/scan";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money } from "@/lib/format";
import type { ItemStatus } from "@/lib/types";

// ⌘K / "/" palette: search items by title, brand, size or SKU, sales by number, and jump to any page.
// A typed or scanned code (SKU, EMP-, LOT-) still goes to the current screen first, as before.

type Result =
  | { kind: "item"; key: string; href: string; sku: string; title: string; status: ItemStatus; price: number | null; meta: string }
  | { kind: "order"; key: string; href: string; label: string; meta: string }
  | { kind: "page"; key: string; href: string; label: string };

type ItemRow = { sku: string; title: string | null; status: ItemStatus; size_label: string | null; list_price_cents: number | null; brands: { name: string } | null };

export function Palette({ isManager, onCode, onCamera, onClose }: {
  isManager: boolean; onCode: (code: string) => void; onCamera: () => void; onClose: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
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
    const all = [...NAV, ...SHORTCUTS].filter((p) => isManager || !p.manager);
    const words = fold(q).split(/\s+/).filter(Boolean);
    const list = words.length
      ? all.filter((p) => words.every((w) => fold(`${p.label} ${"keywords" in p ? p.keywords ?? "" : ""}`).includes(w)))
      : all.slice(0, 6);
    return list.slice(0, 5).map((p) => ({ kind: "page", key: `p:${p.href}`, href: p.href, label: p.label }));
  }, [q, isManager]);

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

  const results = [...orders, ...items, ...pages];
  useEffect(() => setCursor(-1), [q]);

  function open(r: Result) {
    onClose();
    router.push(r.href);
  }
  function submit() {
    if (cursor >= 0 && results[cursor]) return open(results[cursor]);
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
                {r.kind === "item" ? (
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
          {section("Ventes", orders, 0)}
          {section("Articles", items, orders.length)}
          {section(q ? "Pages" : "Aller à", pages, orders.length + items.length)}
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
