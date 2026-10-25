"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/** Full-screen camera barcode reader (Code128 + QR). Works on iPhone Safari via getUserMedia. */
export function CameraScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let done = false;
    (async () => {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: "environment" } },
        videoRef.current!,
        (result) => {
          if (result && !done) {
            done = true;
            navigator.vibrate?.(60);
            onResult(result.getText());
          }
        },
      );
      stop = () => controls.stop();
      if (done) stop();
    })().catch(() => onClose());
    return () => stop?.();
  }, [onResult, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
      <div className="pointer-events-none absolute inset-x-10 top-1/2 h-28 -translate-y-1/2 rounded-lg border-4 border-white/80" />
      <button
        onClick={onClose}
        className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] rounded-full bg-white/90 p-3 text-black"
        aria-label="Fermer"
      >
        <X size={28} />
      </button>
      <p className="absolute inset-x-0 bottom-[max(2rem,env(safe-area-inset-bottom))] text-center text-lg font-semibold text-white">
        Visez l&apos;étiquette
      </p>
    </div>
  );
}
