"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useScan } from "@/components/scan-provider";
import { useToast } from "@/components/toast";
import { Field, StatusChip, btn, input } from "@/components/ui";
import { asItem, rpc } from "@/lib/client-data";
import { eurosInput, money, parseEuros } from "@/lib/format";
import type { Item } from "@/lib/types";

const SELLABLE = ["listed", "reserved", "listing_ready"];

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
      <Field label="Article(s) — scannez ou tapez le SKU">
        <input className={`${input} font-mono uppercase`} value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === "Enter" && sku) { e.preventDefault(); add(sku); } }} placeholder="LSH00001" />
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
