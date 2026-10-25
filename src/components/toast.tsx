"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Tone = "ok" | "error" | "info";
interface Toast {
  id: number;
  tone: Tone;
  text: string;
}

const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Tone = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    // errors stay longer: an operator must not miss a failed save
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 8000 : 2500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto max-w-lg rounded-lg px-4 py-3 text-base font-semibold shadow-lg ${
              t.tone === "error" ? "bg-red-600 text-white" : t.tone === "ok" ? "bg-emerald-600 text-white" : "bg-zinc-800 text-white"
            }`}
            onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
