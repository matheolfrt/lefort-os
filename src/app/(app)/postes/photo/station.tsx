"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ImagePlus, Camera, RotateCw, Trash2 } from "lucide-react";
import { useScan } from "@/components/scan-provider";
import { StationHeader } from "@/components/station-header";
import { useToast } from "@/components/toast";
import { StatusChip, btn, input, seg } from "@/components/ui";
import { CONDITION_LABEL, HOLD_LABEL, STATION_LABEL } from "@/i18n/fr";
import { asItem, loadMeasurements, loadPhotos, rpc } from "@/lib/client-data";
import { compressImage } from "@/lib/image";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Catalog, HoldReason, Item, ItemStatus, Shot } from "@/lib/types";

type Mode = "photo_measure" | "photo" | "measure";

interface Photo {
  key: string; // local key
  id?: string;
  url: string;
  shot_key: string | null;
  state: "uploading" | "ready" | "error";
  file?: File;
}

const TARGET: Record<Mode, ItemStatus> = { photo_measure: "measured", photo: "photographed", measure: "measured" };

export function PhotoStation({ catalog, orgId, minPhotos, initialSku }: {
  catalog: Catalog; orgId: string; minPhotos: number; initialSku: string | null;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("photo_measure");
  const [item, setItem] = useState<Item | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [count, setCount] = useState(0);
  const [skipped, setSkipped] = useState<string[]>([]);
  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    try {
      const m = localStorage.getItem("photoMode") as Mode | null;
      if (m && m in TARGET) setMode(m);
    } catch {}
  }, []);

  const category = catalog.categories.find((c) => c.id === item?.category_id);
  const shots: Shot[] = catalog.shotLists.find((s) => s.id === category?.shot_list_id)?.shots ?? [];
  const defs = catalog.definitions
    .filter((d) => d.template_id === category?.measurement_template_id)
    .sort((a, b) => a.sort - b.sort);
  const brand = catalog.brands.find((b) => b.id === item?.brand_id);

  const open = useCallback(async (it: Item | null) => {
    setItem(it);
    setPhotos([]);
    setValues({});
    setEmpty(!it);
    if (!it) return;
    const [ph, ms] = await Promise.all([loadPhotos(it.id), loadMeasurements(it.id)]);
    setPhotos(ph.map((p) => ({ key: p.id, id: p.id, url: p.url, shot_key: p.shot_key, state: "ready" })));
    setValues(Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, String(v / 10).replace(".", ",")])));
  }, []);

  const next = useCallback(async () => {
    try {
      if (item) await rpc("release_item", { p_item_id: item.id });
      await open(asItem(await rpc<Item>("claim_next_item", { p_station: mode, p_skip: skipped })));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [item, mode, open, skipped, toast]);

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

  // ── Photos ──
  const nextShotKey = (taken: Photo[]) => shots.find((s) => !taken.some((p) => p.shot_key === s.key))?.key ?? null;

  async function upload(p: Photo, it: Item) {
    try {
      const { blob, width, height } = await compressImage(p.file!);
      const path = `${orgId}/${it.id}/${crypto.randomUUID()}.jpg`;
      const sb = supabaseBrowser();
      const { error: upErr } = await sb.storage.from("item-photos").upload(path, blob, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const { data, error } = await sb.from("item_photos").insert({
        org_id: orgId, item_id: it.id, storage_path: path, shot_key: p.shot_key,
        position: Date.now() % 1_000_000_000, width, height, bytes: blob.size,
      }).select("id").single();
      if (error) throw error;
      setPhotos((all) => all.map((x) => (x.key === p.key ? { ...x, id: data.id, state: "ready", file: undefined } : x)));
    } catch {
      setPhotos((all) => all.map((x) => (x.key === p.key ? { ...x, state: "error" } : x)));
    }
  }

  function addFiles(files: FileList | null) {
    if (!files || !item) return;
    const it = item;
    setPhotos((current) => {
      const added: Photo[] = [];
      for (const file of Array.from(files)) {
        const shot_key = nextShotKey([...current, ...added]);
        added.push({ key: crypto.randomUUID(), url: URL.createObjectURL(file), shot_key, state: "uploading", file });
      }
      added.forEach((p) => upload(p, it));
      return [...current, ...added];
    });
  }

  async function setShot(p: Photo, shot_key: string | null) {
    setPhotos((all) => all.map((x) => (x.key === p.key ? { ...x, shot_key } : x)));
    if (p.id) await supabaseBrowser().from("item_photos").update({ shot_key }).eq("id", p.id);
  }

  async function remove(p: Photo) {
    setPhotos((all) => all.filter((x) => x.key !== p.key));
    if (p.id) await supabaseBrowser().from("item_photos").delete().eq("id", p.id);
  }

  // ── Measurements: saved on blur, value typed in cm ──
  async function saveMeasure(defId: string, raw: string) {
    if (!item) return;
    const sb = supabaseBrowser();
    const mm = Math.round(Number(raw.replace(",", ".")) * 10);
    if (!raw.trim()) {
      await sb.from("item_measurements").delete().eq("item_id", item.id).eq("definition_id", defId);
    } else if (mm > 0) {
      const { error } = await sb.from("item_measurements").upsert({ org_id: orgId, item_id: item.id, definition_id: defId, value_mm: mm });
      if (error) toast("Mesure non enregistrée : " + error.message, "error");
    }
  }

  const outOfRange = (defId: string) => {
    const d = defs.find((x) => x.id === defId);
    const mm = Number((values[defId] ?? "").replace(",", ".")) * 10;
    return d && mm > 0 && (mm < d.min_mm || mm > d.max_mm);
  };

  async function validate() {
    if (!item) return;
    if (photos.some((p) => p.state !== "ready")) return toast("Attendez la fin de l'envoi des photos", "error");
    setBusy(true);
    try {
      // flush the focused field first
      if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
      await Promise.all(defs.map((d) => saveMeasure(d.id, values[d.id] ?? "")));
      await rpc("transition_item", { p_item_id: item.id, p_to: TARGET[mode], p_expected_version: null, p_station: mode });
      toast(`${item.sku} → ${mode === "photo" ? "mesures" : "à ranger"}`, "ok");
      setCount((c) => c + 1);
      await open(asItem(await rpc<Item>("claim_next_item", { p_station: mode, p_skip: skipped })));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function hold(reason: HoldReason) {
    if (!item) return;
    try {
      await rpc("transition_item", { p_item_id: item.id, p_to: "on_hold", p_station: mode, p_payload: { hold_reason: reason } });
      toast(`${item.sku} mis en attente`, "ok");
      await next();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const showPhotos = mode !== "measure";
  const showMeasures = mode !== "photo";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <StationHeader title={STATION_LABEL[mode]} done={count}>
        <div role="radiogroup" aria-label="Mode du poste" className="grid w-full grid-cols-3 rounded-xl border border-line bg-panel/80 p-1 sm:w-auto">
          {(["photo_measure", "photo", "measure"] as Mode[]).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => {
                setMode(m);
                try { localStorage.setItem("photoMode", m); } catch {}
              }}
              className={`${seg.item(mode === m)} whitespace-nowrap`}
            >
              {m === "photo_measure" ? "Les deux" : m === "photo" ? "Photo" : "Mesures"}
            </button>
          ))}
        </div>
      </StationHeader>

      {!item ? (
        <div className="space-y-3 rounded-2xl border border-line bg-panel/80 p-6 text-center">
          <p className="text-muted">
            {empty ? "File vide pour ce poste." : "Prenez l'article suivant de la file, ou scannez une étiquette pour ouvrir un article précis."}
          </p>
          <button className={btn.huge} onClick={next}>Article suivant</button>
        </div>
      ) : (
        <>
          <div className="rounded-2xl bg-panel-2 p-4 text-fg ring-1 ring-inset ring-line">
            <div className="flex items-start justify-between gap-2">
              <div>
                <Link href={`/stock/${item.sku}`} className="font-mono text-3xl font-black">{item.sku}</Link>
                <div className="mt-1 text-lg">{[category?.name, brand?.name, item.size_label && `T${item.size_label}`].filter(Boolean).join(" · ")}</div>
                <div className="text-sm opacity-70">{item.condition ? CONDITION_LABEL[item.condition] : "État non renseigné"}{item.defects && ` · ${item.defects}`}</div>
              </div>
              <StatusChip status={item.status} large />
            </div>
          </div>

          {showPhotos && (
            <section className="rounded-2xl border border-line bg-panel/80 p-4">
              <h2 className="mb-2 eyebrow text-muted">Photos</h2>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {shots.map((s) => {
                  const ok = photos.some((p) => p.shot_key === s.key && p.state !== "error");
                  return (
                    <span key={s.key} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ok ? "bg-emerald-600 text-white" : s.required ? "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300" : "bg-line/70 text-muted"}`}>
                      {ok ? "✓" : s.required ? "•" : "○"} {s.label}
                    </span>
                  );
                })}
                <span className="ml-auto self-center text-xs tabular-nums text-muted">{photos.length} / min. {minPhotos}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {photos.map((p) => (
                  <div key={p.key} className="relative overflow-hidden rounded-lg border border-line">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" className={`aspect-[3/4] w-full object-cover ${p.state === "uploading" ? "opacity-50" : ""}`} />
                    {p.state === "error" && (
                      <button className="absolute inset-0 flex items-center justify-center bg-red-600/80 font-semibold text-white" onClick={() => {
                        setPhotos((all) => all.map((x) => (x.key === p.key ? { ...x, state: "uploading" } : x)));
                        upload(p, item);
                      }}>
                        <RotateCw size={18} /> Réessayer
                      </button>
                    )}
                    <div className="absolute inset-x-0 bottom-0 flex bg-black/65">
                      <select aria-label="Type de photo" className="min-h-9 min-w-0 flex-1 bg-transparent px-1 text-xs text-white" value={p.shot_key ?? ""} onChange={(e) => setShot(p, e.target.value || null)}>
                        <option value="">Autre</option>
                        {shots.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                      <button className="flex w-9 items-center justify-center text-white" onClick={() => remove(p)} aria-label="Supprimer la photo"><Trash2 size={15} /></button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className={`${btn.primary} cursor-pointer`}>
                  <ImagePlus size={20} /> Photothèque
                  <input type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
                </label>
                <label className={`${btn.secondary} cursor-pointer`}>
                  <Camera size={20} /> Appareil photo
                  <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
                </label>
              </div>
              <p className="mt-2 text-xs text-muted">
                Conseil : prenez les photos avec l&apos;app Appareil photo (elles restent dans la photothèque pour Vinted), dans l&apos;ordre de la liste ci-dessus.
              </p>
            </section>
          )}

          {showMeasures && defs.length > 0 && (
            <section className="rounded-2xl border border-line bg-panel/80 p-4">
              <h2 className="mb-3 eyebrow text-muted">Mesures à plat (cm)</h2>
              <div className="grid grid-cols-2 gap-3">
                {defs.map((d, i) => (
                  <label key={d.id} className="block">
                    <span className="mb-1 block text-sm font-medium">{d.label}{!d.required && <span className="text-muted"> (opt.)</span>}</span>
                    <input
                      ref={(el) => { fieldRefs.current[i] = el; }}
                      className={`${input} text-xl tabular-nums ${outOfRange(d.id) ? "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" : ""}`}
                      inputMode="decimal"
                      enterKeyHint={i === defs.length - 1 ? "done" : "next"}
                      value={values[d.id] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [d.id]: e.target.value }))}
                      onBlur={(e) => saveMeasure(d.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const nextField = fieldRefs.current[i + 1];
                          if (nextField) nextField.focus();
                          else (e.target as HTMLInputElement).blur();
                        }
                      }}
                    />
                    {outOfRange(d.id) && <span className="text-xs text-amber-700">Inhabituel ({d.min_mm / 10}–{d.max_mm / 10} cm) — vérifiez</span>}
                  </label>
                ))}
              </div>
            </section>
          )}
          {showMeasures && defs.length === 0 && category && (
            <p className="text-sm text-muted">Pas de gabarit de mesures pour « {category.name} ».</p>
          )}

          <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 grid grid-cols-[1fr_auto] gap-2 rounded-2xl bg-bg/90 py-2 backdrop-blur md:bottom-3">
            <button className={btn.huge} disabled={busy} onClick={validate}>Valider et suivant</button>
            <details className="relative">
              <summary className={`${btn.secondary} min-h-16 cursor-pointer list-none`} aria-label="Autres actions">Autre…</summary>
              <div className="absolute bottom-full right-0 mb-2 w-56 space-y-1 rounded-lg border border-line bg-panel p-2 shadow-xl">
                <button className={`${btn.secondary} w-full`} onClick={() => { setSkipped((s) => [...s, item.id]); next(); }}>Passer</button>
                {(Object.keys(HOLD_LABEL) as HoldReason[]).map((r) => (
                  <button key={r} className={`${btn.secondary} w-full`} onClick={() => hold(r)}>Attente : {HOLD_LABEL[r]}</button>
                ))}
              </div>
            </details>
          </div>
        </>
      )}
    </div>
  );
}
