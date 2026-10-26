"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { useScan } from "@/components/scan-provider";
import { useToast } from "@/components/toast";
import { Field, StatusChip, btn, input } from "@/components/ui";
import { asItem, rpc } from "@/lib/client-data";
import { supabaseBrowser } from "@/lib/supabase/client";
import { eurosInput, money, parseEuros } from "@/lib/format";
import type { Item } from "@/lib/types";

const SELLABLE = ["listed", "reserved", "listing_ready"];

type Hit = { id: string; sku: string; title: string | null; size_label: string | null; list_price_cents: number | null; brands: { name: string } | null };

export function NewSale() {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [sku, setSku] = useState("");
  const [gross, setGross] = useState("");
  const [soldAt, setSoldAt] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [buyer, setBuyer] = useState("");
  const [ref, setRef] = useState("");
  const [shipping, setShipping] = useState("");
  const [packaging, setPackaging] = useState("");
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [cursor, setCursor] = useState(0);

  // search sellable items by title, brand, SKU or size as you type
  useEffect(() => {
    const q = sku.replace(/[%,()*]/g, " ").trim();
    if (q.length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      const words = q.split(/\s+/).filter(Boolean);
      const db = supabaseBrowser();
      const { data: brands } = await db.from("brands").select("id, name").or(words.map((w) => `name.ilike.%${w}%`).join(","));
      const brandIds = (w: string) => ((brands ?? []) as { id: string; name: string }[]).filter((b) => b.name.toLowerCase().includes(w.toLowerCase())).map((b) => b.id);
      let query = db.from("items")
        .select("id, sku, title, size_label, list_price_cents, brands(name)")
        .is("deleted_at", null).in("status", SELLABLE);
      // every word must match the title, the SKU or the brand (or be the size)
      for (const w of words) {
        const ids = brandIds(w);
        query = query.or(`title.ilike.%${w}%,sku.ilike.%${w}%,size_label.ilike.${w}${ids.length ? `,brand_id.in.(${ids.join(",")})` : ""}`);
      }
      const { data } = await query.order("listed_at", { ascending: false, nullsFirst: false }).limit(8);
      setHits((data ?? []) as unknown as Hit[]);
      setCursor(0);
    }, 180);
    return () => clearTimeout(t);
  }, [sku]);

  async function add(code: string) {
    const it = asItem(await rpc<Item>("find_item_by_sku", { p_sku: code }).catch(() => null));
    if (!it) return toast(`${code} introuvable`, "error");
    if (!SELLABLE.includes(it.status)) return toast(`${it.sku} n'est pas en vente`, "error");
    setItems((cur) => {
      if (cur.some((x) => x.id === it.id)) return cur;
      const next = [...cur, it];
      setGross(eurosInput(next.reduce((s, x) => s + (x.list_price_cents ?? 0), 0)));
      return next;
    });
    setSku("");
    setHits([]);
  }

  useScan((scan) => {
    if (scan.kind !== "item") return false;
    add(scan.code);
    return true;
  });

  async function submit() {
    const grossCents = parseEuros(gross);
    if (!items.length) return toast("Ajoutez au moins un article", "error");
    if (grossCents == null) return toast("Montant invalide", "error");
    setBusy(true);
    try {
      await rpc("record_sale", {
        p_item_ids: items.map((i) => i.id),
        p_gross_cents: grossCents,
        p_sold_at: new Date(soldAt).toISOString(),
        p_channel: "vinted",
        p_external_order_id: ref || null,
        p_buyer: buyer || null,
        p_shipping_cost_cents: parseEuros(shipping) ?? 0,
        p_packaging_cost_cents: parseEuros(packaging) ?? 0,
      });
      toast("Vente enregistrée → à expédier", "ok");
      setItems([]);
      setGross("");
      setBuyer("");
      setRef("");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Field label="Article(s) — cherchez par titre, marque, taille ou SKU, ou scannez">
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className={`${input} pl-10`} value={sku} onChange={(e) => setSku(e.target.value)}
            role="combobox" aria-expanded={hits.length > 0} aria-controls="sale-hits" aria-autocomplete="list"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && hits.length) { e.preventDefault(); setCursor((c) => (c + 1) % hits.length); }
              if (e.key === "ArrowUp" && hits.length) { e.preventDefault(); setCursor((c) => (c - 1 + hits.length) % hits.length); }
              if (e.key === "Escape") setHits([]);
              if (e.key === "Enter" && sku) {
                e.preventDefault();
                add(hits[cursor]?.sku ?? sku.toUpperCase());
              }
            }} placeholder="Ex. blazer boss bleu 50" />
          {hits.length > 0 && (
            <ul id="sale-hits" role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-auto rounded-lg border border-line bg-panel shadow-lg">
              {hits.map((h, i) => (
                <li key={h.id} role="option" aria-selected={i === cursor}>
                  <button type="button" onMouseEnter={() => setCursor(i)} onClick={() => add(h.sku)}
                    className={`flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left ${i === cursor ? "bg-bg" : ""}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{h.title ?? h.brands?.name ?? "Sans titre"}</span>
                      <span className="block text-xs text-muted">
                        <span className="font-mono">{h.sku}</span>{h.size_label && ` · taille ${h.size_label}`}{h.brands?.name && ` · ${h.brands.name}`}
                      </span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums">{money(h.list_price_cents)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {sku.trim().length >= 2 && hits.length === 0 && (
            <p className="mt-1 text-xs text-muted">Aucun article en vente ne correspond. Entrée pour chercher le SKU exact.</p>
          )}
        </div>
      </Field>
      {items.map((i) => (
        <div key={i.id} className="flex items-center gap-2 rounded-md border border-line p-2">
          <span className="font-mono font-semibold">{i.sku}</span>
          <StatusChip status={i.status} />
          <span className="flex-1 truncate text-sm text-muted">{i.title}</span>
          <span className="text-sm tabular-nums">{money(i.list_price_cents)}</span>
          <button onClick={() => setItems((x) => x.filter((y) => y.id !== i.id))} aria-label="Retirer"><X size={16} /></button>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Prix de vente total (€)" hint={items.length > 1 ? "Lot : réparti au prorata des prix" : undefined}>
          <input className={`${input} text-xl`} inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} />
        </Field>
        <Field label="Date de vente">
          <input className={input} type="datetime-local" value={soldAt} onChange={(e) => setSoldAt(e.target.value)} />
        </Field>
        <Field label="Acheteur"><input className={input} value={buyer} onChange={(e) => setBuyer(e.target.value)} /></Field>
        <Field label="Réf. commande"><input className={input} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        <Field label="Frais de port à ma charge (€)"><input className={input} inputMode="decimal" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0" /></Field>
        <Field label="Emballage (€)"><input className={input} inputMode="decimal" value={packaging} onChange={(e) => setPackaging(e.target.value)} placeholder="0" /></Field>
      </div>
      <p className="text-xs text-muted">Les frais Vinted Pro sont calculés selon Paramètres (modifiables ensuite sur la commande).</p>
      <button className={`${btn.primary} w-full`} disabled={busy} onClick={submit}>Enregistrer la vente</button>
    </div>
  );
}
