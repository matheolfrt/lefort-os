"use client";

import { useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

/** Whole screen for a station on a phone or a tablet (where the browser allows it; hidden elsewhere) */
export function FullscreenButton() {
  const [can, setCan] = useState(false);
  const [on, setOn] = useState(false);
  useEffect(() => {
    setCan(!!document.documentElement.requestFullscreen);
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  if (!can) return null;
  const toggle = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  return (
    <button type="button" onClick={toggle} aria-pressed={on} data-testid="fullscreen"
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-muted ring-1 ring-inset ring-line transition hover:text-fg"
      aria-label={on ? "Quitter le plein écran" : "Plein écran"} title={on ? "Quitter le plein écran" : "Plein écran"}>
      {on ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
    </button>
  );
}
