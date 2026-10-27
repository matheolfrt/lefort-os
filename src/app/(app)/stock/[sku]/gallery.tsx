"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

/** Large photo with its thumbnails underneath; a click on the large one opens it full size */
export function Gallery({ photos, total = photos.length }: { photos: { url: string; label: string }[]; total?: number }) {
  const [i, setI] = useState(0);
  if (!photos.length) {
    return (
      <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl bg-bg/60 text-sm text-muted">
        <ImageOff size={28} /> {total ? "Photos momentanément indisponibles : rechargez la page" : "Pas encore de photo"}
      </div>
    );
  }
  const main = photos[Math.min(i, photos.length - 1)];
  return (
    <div className="space-y-2">
      <a href={main.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl bg-bg/60">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={main.url} alt={main.label} className="mx-auto max-h-[520px] w-full object-contain" />
      </a>
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((p, k) => (
            <button key={p.url} type="button" onClick={() => setI(k)} aria-label={`Photo ${k + 1}`} aria-pressed={k === i}
              className={`size-16 shrink-0 overflow-hidden rounded-lg ring-2 transition ${k === i ? "ring-accent" : "ring-transparent opacity-70 hover:opacity-100"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
