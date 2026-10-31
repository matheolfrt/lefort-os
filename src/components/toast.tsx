"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Tone = "ok" | "error" | "info";
/** An action offered with the message, typically « Annuler » right after a change */
export interface ToastAction { label: string; run: () => void | Promise<void> }
interface ToastOptions { action?: ToastAction; duration?: number }
interface Toast {
  id: number;
  tone: Tone;
  text: string;
  action?: ToastAction;
}

type Push = (text: string, tone?: Tone, options?: ToastOptions) => void;
const ToastContext = createContext<Push>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback<Push>((text, tone = "info", options = {}) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, text, action: options.action }]);
    // errors stay longer: an operator must not miss a failed save; an undo stays long enough to be used
    const ms = options.duration ?? (options.action ? 7000 : tone === "error" ? 8000 : 2500);
    setTimeout(() => dismiss(id), ms);
  }, [dismiss]);
  return (
    <ToastContext.Provider value={push}>
      {children}
      {/* phone: at the bottom, above the bar, where the thumb and the eyes are; computer: at the top */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-4 md:bottom-auto md:top-3" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pop-in pointer-events-auto flex max-w-lg items-center gap-3 rounded-xl px-4 py-3 text-base font-semibold shadow-lg ${
              t.tone === "error" ? "bg-red-600 text-white" : t.tone === "ok" ? "bg-emerald-600 text-white" : "bg-zinc-800 text-white"
            }`}
            onClick={() => !t.action && dismiss(t.id)}
          >
            <span className="min-w-0 flex-1">{t.text}</span>
            {t.action && (
              <button type="button" data-toast-action
                className="-my-1 shrink-0 rounded-lg bg-white/20 px-3 py-1.5 text-sm font-bold hover:bg-white/30"
                onClick={async (e) => { e.stopPropagation(); dismiss(t.id); await t.action!.run(); }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
