"use client";

import { useEffect, useState } from "react";
import { Printer, X } from "lucide-react";
import { useToast } from "@/components/toast";
import { btn, seg } from "@/components/ui";
import { ZONES, fitLabel, isZoneKey, sourceKind, type LabelSource, type ZoneKey } from "@/lib/shipping-label";

const ZONE_PREF = "lf_label_zone";

/**
 * « Bordereau Vinted »: the PDF (or screenshot) Vinted gives, cut to the label and sized for the MUNBYN 4 × 6 roll.
 * Opened in a new tab: on iPhone, Partager → MUNBYN; on a computer, print at 100 % on the 4 × 6 paper.
 */
export function LabelPrinter({ onClose }: { onClose?: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<{ name: string; src: LabelSource } | null>(null);
  const [zone, setZone] = useState<ZoneKey>("page");
  const [out, setOut] = useState<{ url: string; pages: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // the zone chosen last time: Vinted's layout does not change from one parcel to the next
  useEffect(() => {
    try { const v = localStorage.getItem(ZONE_PREF); if (isZoneKey(v)) setZone(v); } catch { /* private mode */ }
  }, []);

  useEffect(() => {
    if (!file) return;
    let cancelled = false, url: string | null = null;
    setBusy(true);
    fitLabel(file.src, ZONES[zone].zone)
      .then(({ pdf, pages }) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([pdf as BlobPart], { type: "application/pdf" }));
        setOut({ url, pages });
      })
      .catch((e) => { if (!cancelled) { setOut(null); toast(`Bordereau illisible : ${(e as Error).message}`, "error"); } })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [file, zone, toast]);

  async function pick(f: File | undefined) {
    if (!f) return;
    const kind = sourceKind(f);
    if (!kind) { toast("Choisissez le PDF du bordereau, ou une capture en PNG ou JPG.", "error"); return; }
    setFile({ name: f.name, src: { kind, bytes: new Uint8Array(await f.arrayBuffer()) } });
  }

  function choose(z: ZoneKey) {
    setZone(z);
    try { localStorage.setItem(ZONE_PREF, z); } catch { /* private mode */ }
  }

  return (
    <section aria-label="Bordereau Vinted" className="space-y-3 rounded-xl border-2 border-line bg-panel p-4" data-testid="label-printer">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-bold">Bordereau Vinted → MUNBYN</h2>
          <p className="text-sm text-muted">Le PDF de Vinted (ou une capture), mis au format du rouleau 102 × 152 mm.</p>
        </div>
        {onClose && <button type="button" onClick={onClose} className={btn.icon} aria-label="Fermer"><X size={18} /></button>}
      </div>

      <label
        className="flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-line px-4 py-3 text-center hover:border-fg/30"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}
      >
        <span className="font-medium">{file ? file.name : "Choisir ou déposer le bordereau"}</span>
        <span className="text-xs text-muted">{file ? "Toucher pour en choisir un autre" : "PDF, PNG ou JPG"}</span>
        <input type="file" accept="application/pdf,.pdf,image/png,image/jpeg" className="sr-only"
          onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      </label>

      {file && (
        <>
          <div>
            <p className="eyebrow-tight mb-1.5 text-muted">Où est l&apos;étiquette sur la page ?</p>
            <div className="flex flex-wrap items-center gap-3">
              <div role="radiogroup" aria-label="Zone de l'étiquette" className={`${seg.wrap} flex-wrap`}>
                {(Object.keys(ZONES) as ZoneKey[]).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={zone === k} onClick={() => choose(k)} className={seg.item(zone === k)}>
                    {ZONES[k].name}
                  </button>
                ))}
              </div>
              <ZoneSketch zone={zone} />
            </div>
          </div>

          {out && (
            <object data={out.url} type="application/pdf" aria-label="Aperçu du bordereau"
              className="hidden h-[432px] w-[288px] rounded-lg border border-line bg-white sm:block" />
          )}

          <div className="flex flex-wrap gap-2">
            <a href={out?.url} target="_blank" rel="noopener" aria-disabled={!out || busy}
              className={`${btn.primary} ${!out || busy ? "pointer-events-none opacity-50" : ""}`}>
              <Printer size={18} aria-hidden /> {busy ? "Préparation…" : `Ouvrir pour imprimer${out && out.pages > 1 ? ` (${out.pages} étiquettes)` : ""}`}
            </a>
            <a href={out?.url} download={`bordereau-${file.name.replace(/\.[^.]+$/, "")}-4x6.pdf`} aria-disabled={!out || busy}
              className={`${btn.secondary} ${!out || busy ? "pointer-events-none opacity-50" : ""}`}>
              Télécharger
            </a>
          </div>
          <p className="text-xs text-muted">
            iPhone : Partager → MUNBYN. Ordinateur : imprimer à 100 % (taille réelle) sur le papier 4 × 6. Le fichier reste sur cet appareil.
          </p>
        </>
      )}
    </section>
  );
}

/** A small A4 sheet with the chosen zone filled, to check the choice at a glance */
function ZoneSketch({ zone }: { zone: ZoneKey }) {
  const z = ZONES[zone].zone;
  return (
    <svg viewBox="0 0 21 29.7" width={42} height={59} aria-hidden className="shrink-0">
      <rect x={0.5} y={0.5} width={20} height={28.7} rx={1} className="fill-panel-2 stroke-line" strokeWidth={1} />
      <rect x={0.5 + 20 * z.x} y={0.5 + 28.7 * z.y} width={20 * z.w} height={28.7 * z.h} className="fill-accent/70" />
    </svg>
  );
}
