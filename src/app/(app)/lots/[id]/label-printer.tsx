"use client";

import { useState, useTransition } from "react";
import { Printer } from "lucide-react";
import { btn, input } from "@/components/ui";
import { issueLabels } from "./actions";

const FORMATS = [
  { value: "57x32", label: "57 × 32 mm" },
  { value: "50x30", label: "50 × 30 mm" },
  { value: "4x6", label: "4 × 6 (4 par feuille)" },
];

export function LabelPrinter({ batchId, unused, suggested, open }: {
  batchId: string; unused: number; suggested: number; open: boolean;
}) {
  const [qty, setQty] = useState(suggested || 10);
  const [format, setFormat] = useState(() => (typeof window !== "undefined" && localStorage.getItem("labelFormat")) || "57x32");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const pdfUrl = (extra: string) => `/etiquettes/articles?batch=${batchId}&format=${format}${extra}`;
  const remember = (f: string) => {
    setFormat(f);
    try { localStorage.setItem("labelFormat", f); } catch {}
  };

  return (
    <div className="space-y-3">
      <select className={input} value={format} onChange={(e) => remember(e.target.value)} aria-label="Format">
        {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>
      {open && (
        <div className="flex gap-2">
          <input className={`${input} w-24`} type="number" min={1} max={1000} value={qty} onChange={(e) => setQty(Number(e.target.value))} inputMode="numeric" />
          <button
            className={`${btn.primary} flex-1`}
            disabled={pending || qty < 1}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await issueLabels(batchId, qty);
                if (r.error) return setError(r.error);
                window.open(`/etiquettes/articles?skus=${r.skus!.join(",")}&format=${format}`, "_blank");
              })
            }
          >
            <Printer size={18} /> Générer {qty} étiquettes
          </button>
        </div>
      )}
      {unused > 0 && (
        <a className={`${btn.secondary} w-full`} href={pdfUrl("&scope=unused")} target="_blank">
          Réimprimer les {unused} étiquettes non utilisées
        </a>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-muted">
        iPhone : ouvrez le PDF → Partager → MUNBYN. Ordinateur : imprimez à 100 % sur la MUNBYN P130B.
      </p>
    </div>
  );
}
