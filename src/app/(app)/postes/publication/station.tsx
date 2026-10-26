"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Download, ExternalLink, Share } from "lucide-react";
import { useScan } from "@/components/scan-provider";
import { StationHeader } from "@/components/station-header";
import { useToast } from "@/components/toast";
import { Field, StatusChip, btn, input } from "@/components/ui";
import { asItem, loadMeasurements, loadPhotos, rpc } from "@/lib/client-data";
import { buildListingText } from "@/lib/listing-text";
import { eurosInput, money, parseEuros } from "@/lib/format";
import { vintedIdFromUrl } from "@/lib/scan";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Catalog, Item, ItemPhoto } from "@/lib/types";

export function ListingStation({ catalog, signature, isManager, initialSku }: {
  catalog: Catalog; signature: string; isManager: boolean; initialSku: string | null;
}) {
  const toast = useToast();
  const [item, setItem] = useState<Item | null>(null);
  const [photos, setPhotos] = useState<(ItemPhoto & { url: string })[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [url, setUrl] = useState("");
  const [cost, setCost] = useState<number | null>(null);
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);

  const open = useCallback(async (it: Item | null) => {
    setItem(it);
    setEmpty(!it);
    setUrl("");
    setPhotos([]);
    setCost(null);
    if (!it) return;
    const [ph, ms] = await Promise.all([loadPhotos(it.id), loadMeasurements(it.id)]);
    setPhotos(ph);
    const generated = buildListingText(it, catalog, ms, signature);
    setTitle(it.title || generated.title);
    setDescription(it.description || generated.description);
    setPrice(eurosInput(it.list_price_cents));
    setMinPrice(eurosInput(it.min_price_cents));
    if (isManager) {
      const { data } = await supabaseBrowser().from("item_costs").select("allocated_cost_cents").eq("item_id", it.id).maybeSingle();
      setCost(data?.allocated_cost_cents ?? null);
    }
  }, [catalog, signature, isManager]);

  const next = useCallback(async () => {
    try {
      if (item) await rpc("release_item", { p_item_id: item.id });
      await open(asItem(await rpc<Item>("claim_next_item", { p_station: "listing" })));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [item, open, toast]);

  const openSku = useCallback(async (sku: string) => {
    try {
      const found = asItem(await rpc<Item>("find_item_by_sku", { p_sku: sku }));
      if (!found) return toast(`${sku} introuvable`, "error");
      await open(asItem(await rpc<Item>("claim_item", { p_item_id: found.id })));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [open, toast]);

  useEffect(() => {
    if (initialSku) openSku(initialSku);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useScan((scan) => {
    if (scan.kind !== "item") return false;
    openSku(scan.code);
    return true;
  });

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copié`, "ok");
    } catch {
      toast("Copie impossible : sélectionnez le texte manuellement", "error");
    }
  }

  // iPhone: the share sheet offers "Enregistrer X images" → photos land in the camera roll for the Vinted app
  async function sharePhotos() {
    try {
      const files = await Promise.all(
        photos.map(async (p, i) => {
          const blob = await (await fetch(p.url)).blob();
          return new File([blob], `${item!.sku}-${i + 1}.jpg`, { type: "image/jpeg" });
        }),
      );
      if (navigator.canShare?.({ files })) await navigator.share({ files });
      else files.forEach((f) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(f);
        a.download = f.name;
        a.click();
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast("Partage impossible", "error");
    }
  }

  async function saveDraft() {
    if (!item) return;
    const { error } = await supabaseBrowser().from("items").update({
      title, description, list_price_cents: parseEuros(price), min_price_cents: parseEuros(minPrice) || null,
    }).eq("id", item.id);
    if (error) toast(error.message, "error");
  }

  async function publish() {
    if (!item) return;
    const priceCents = parseEuros(price);
    if (!priceCents) return toast("Prix de vente obligatoire", "error");
    if (!url.trim()) return toast("Collez le lien de l'annonce Vinted", "error");
    setBusy(true);
    try {
      const minCents = parseEuros(minPrice);
      if (minCents && minCents > priceCents) throw new Error("Le prix minimum dépasse le prix affiché.");
      // min price before publish so the price check uses the new value
      const { error } = await supabaseBrowser().from("items").update({ min_price_cents: minCents || null }).eq("id", item.id);
      if (error) throw error;
      await rpc("publish_item", {
        p_item_id: item.id, p_url: url.trim(), p_price_cents: priceCents, p_title: title, p_description: description,
        p_channel: "vinted", p_external_id: vintedIdFromUrl(url),
      });
      toast(`${item.sku} en ligne`, "ok");
      await open(asItem(await rpc<Item>("claim_next_item", { p_station: "listing" })));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (!item) {
    return (
      <div className="mx-auto max-w-3xl">
        <StationHeader title="Publication" />
        <div className="space-y-3 rounded-xl border border-line bg-panel p-6 text-center">
          <p className="text-muted">
            {empty ? "Aucun article prêt à publier." : "Prenez l'article suivant, ou scannez une étiquette pour ouvrir un article précis."}
          </p>
          <button className={btn.huge} onClick={next}>Article suivant</button>
        </div>
      </div>
    );
  }

  const step = "mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-muted";
  const num = "flex size-5 items-center justify-center rounded-full bg-ink text-[11px] text-ink-fg";

  return (
    <div className="mx-auto max-w-6xl">
      <StationHeader title="Publication">
        <Link href={`/stock/${item.sku}`} className="font-mono text-lg font-black hover:text-accent">{item.sku}</Link>
        <StatusChip status={item.status} large />
      </StationHeader>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <section className="h-fit rounded-xl border border-line bg-panel p-4">
          <h2 className={step}><span className={num}>1</span> Photos · {photos.length}</h2>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <a key={p.id} href={p.url} target="_blank" draggable>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.shot_key ?? ""} className="aspect-[3/4] w-full rounded-lg object-cover" />
              </a>
            ))}
          </div>
          <button className={`${btn.secondary} mt-3 w-full`} onClick={sharePhotos} disabled={!photos.length}>
            <Share size={18} /> Enregistrer les {photos.length} photos sur le téléphone
          </button>
          <p className="mt-2 hidden text-xs text-muted lg:block"><Download size={12} className="inline" /> Sur ordinateur : glissez les photos directement dans le formulaire Vinted.</p>
        </section>

        <div className="space-y-4">
          <section className="space-y-3 rounded-xl border border-line bg-panel p-4">
            <h2 className={step}><span className={num}>2</span> Texte et prix</h2>
            <Field label="Titre">
              <div className="flex gap-2">
                <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveDraft} />
                <button className={`${btn.secondary} shrink-0 px-3`} onClick={() => copy(title, "Titre")} aria-label="Copier le titre"><Copy size={18} /></button>
              </div>
            </Field>
            <Field label="Description">
              <textarea className={`${input} min-h-56 py-2 font-mono text-sm`} value={description} onChange={(e) => setDescription(e.target.value)} onBlur={saveDraft} />
              <button className={`${btn.secondary} mt-2 w-full`} onClick={() => copy(description, "Description")}><Copy size={18} /> Copier la description</button>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prix affiché (€)" hint={cost != null ? `Coût de revient : ${money(cost)}` : undefined}>
                <div className="flex gap-2">
                  <input className={`${input} min-w-0 text-xl tabular-nums`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} onBlur={saveDraft} />
                  <button className={`${btn.secondary} shrink-0 px-3`} onClick={() => copy(price, "Prix")} aria-label="Copier le prix"><Copy size={18} /></button>
                </div>
              </Field>
              <Field label="Prix minimum (€)" hint="Offres acceptables jusqu'à">
                <input className={`${input} text-xl tabular-nums`} inputMode="decimal" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
              </Field>
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-line bg-panel p-4">
            <h2 className={step}><span className={num}>3</span> Publier sur Vinted</h2>
            <a className={`${btn.secondary} w-full`} href="https://www.vinted.fr/items/new" target="_blank" rel="noreferrer">
              <ExternalLink size={18} /> Ouvrir Vinted
            </a>
            <Field label="Lien de l'annonce Vinted" hint="Après publication : Partager → Copier le lien, puis collez ici.">
              <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.vinted.fr/items/…" inputMode="url" />
            </Field>
          </section>

          <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 grid grid-cols-[1fr_auto] gap-2 rounded-2xl bg-bg/90 py-2 backdrop-blur md:bottom-3">
            <button className={btn.huge} disabled={busy} onClick={publish}>Marquer en ligne et suivant</button>
            <button className={`${btn.secondary} min-h-16`} onClick={next}>Passer</button>
          </div>
        </div>
      </div>
    </div>
  );
}
