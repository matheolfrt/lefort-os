"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CameraScanner } from "./camera-scanner";
import { useToast } from "./toast";
import { classifyScan, type ScanResult } from "@/lib/scan";

/** Return true when the scan was consumed; otherwise the global default applies. */
type Handler = (scan: ScanResult) => boolean | Promise<boolean>;

interface ScanApi {
  register: (h: Handler) => () => void;
  openCamera: () => void;
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
    <ScanContext.Provider value={{ register, openCamera: () => setCamera(true), dispatch }}>
      {children}
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
