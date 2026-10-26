"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Camera, ScanLine } from "lucide-react";
import { CameraScanner } from "./camera-scanner";
import { useToast } from "./toast";
import { classifyScan, type ScanResult } from "@/lib/scan";

/** Return true when the scan was consumed; otherwise the global default applies. */
type Handler = (scan: ScanResult) => boolean | Promise<boolean>;

interface ScanApi {
  register: (h: Handler) => () => void;
  openCamera: () => void;
  /** Quick "scan or type a code" dialog, also on ⌘K / Ctrl+K and "/" */
  openQuick: () => void;
  dispatch: (raw: string) => void;
}

const ScanContext = createContext<ScanApi | null>(null);

// Hardware scanners type like a very fast keyboard and end with Enter
const MAX_GAP_MS = 40;
const MIN_LENGTH = 4;

export function ScanProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const handlers = useRef<Handler[]>([]);
  const [camera, setCamera] = useState(false);
  const [quick, setQuick] = useState(false);

  const dispatch = useCallback(
    async (raw: string) => {
      const scan = classifyScan(raw);
      for (const h of [...handlers.current].reverse()) {
        if (await h(scan)) return;
      }
      if (scan.kind === "item") router.push(`/stock/${scan.code}`);
      else if (scan.kind === "location") router.push(`/emplacements/${scan.code}`);
      else if (scan.kind === "batch") router.push(`/lots?code=${scan.code}`);
      else toast(`Code non reconnu : ${scan.code}`, "error");
    },
    [router, toast],
  );

  // Keyboard-wedge detection. Characters typed in a fast burst are a scan, not typing:
  // they are swallowed (and the first leaked character removed from the focused input).
  useEffect(() => {
    let buffer = "";
    let last = 0;
    let target: HTMLInputElement | HTMLTextAreaElement | null = null;
    let valueBefore = "";
    let scanning = false;

    const onKey = (e: KeyboardEvent) => {
      const now = performance.now();
      const gap = now - last;
      last = now;
      if (e.key === "Enter") {
        if (scanning && buffer.length >= MIN_LENGTH) {
          e.preventDefault();
          e.stopPropagation();
          if (target) {
            const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), "value")?.set;
            setter?.call(target, valueBefore);
            target.dispatchEvent(new Event("input", { bubbles: true }));
          }
          dispatch(buffer);
        }
        buffer = "";
        scanning = false;
        return;
      }
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      if (gap > MAX_GAP_MS) {
        buffer = e.key;
        scanning = false;
        const el = document.activeElement;
        target = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null;
        valueBefore = target?.value ?? "";
      } else {
        buffer += e.key;
        if (buffer.length >= 3) scanning = true;
        if (scanning) e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dispatch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if ((e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setQuick(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const register = useCallback((h: Handler) => {
    handlers.current.push(h);
    return () => {
      handlers.current = handlers.current.filter((x) => x !== h);
    };
  }, []);

  const onCameraResult = useCallback(
    (text: string) => {
      setCamera(false);
      dispatch(text);
    },
    [dispatch],
  );
  const closeCamera = useCallback(() => setCamera(false), []);

  return (
    <ScanContext.Provider value={{ register, openCamera: () => setCamera(true), openQuick: () => setQuick(true), dispatch }}>
      {children}
      {quick && (
        <QuickScan
          onSubmit={(code) => { setQuick(false); dispatch(code); }}
          onCamera={() => { setQuick(false); setCamera(true); }}
          onClose={() => setQuick(false)}
        />
      )}
      {camera && <CameraScanner onResult={onCameraResult} onClose={closeCamera} />}
    </ScanContext.Provider>
  );
}

export function useScanApi() {
  const api = useContext(ScanContext);
  if (!api) throw new Error("ScanProvider missing");
  return api;
}

/** Lets a screen consume scans while it is mounted */
export function useScan(handler: Handler) {
  const { register } = useScanApi();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => register((s) => ref.current(s)), [register]);
}

function QuickScan({ onSubmit, onCamera, onClose }: { onSubmit: (code: string) => void; onCamera: () => void; onClose: () => void }) {
  const [value, setValue] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm px-4 pt-[max(4rem,env(safe-area-inset-top))]" onClick={onClose}>
      <form
        role="dialog"
        aria-label="Scanner un code"
        className="w-full max-w-md overflow-hidden rounded-2xl bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <ScanLine size={20} className="shrink-0 text-muted" />
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            placeholder="SKU, emplacement ou lot — ex. LSH00042"
            autoCapitalize="characters"
            autoComplete="off"
            className="min-h-14 w-full bg-transparent font-mono text-lg outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 p-3">
          <button type="button" onClick={onCamera} className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-line font-semibold">
            <Camera size={18} /> Caméra
          </button>
          <button type="submit" className="min-h-12 rounded-lg bg-accent font-semibold text-accent-fg disabled:opacity-40" disabled={!value.trim()}>
            Ouvrir
          </button>
        </div>
        <p className="px-4 pb-3 text-xs text-muted">Une douchette fonctionne aussi depuis n&apos;importe quel écran, sans ouvrir cette fenêtre.</p>
      </form>
    </div>
  );
}
