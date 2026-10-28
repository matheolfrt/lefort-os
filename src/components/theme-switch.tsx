"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Monitor, Moon, Sun } from "lucide-react";
import { setTheme } from "@/app/prefs-actions";
import type { Theme } from "@/lib/prefs";

const OPTIONS: { key: Theme; label: string; icon: typeof Sun }[] = [
  { key: "dark", label: "Sombre", icon: Moon },
  { key: "light", label: "Clair", icon: Sun },
  { key: "auto", label: "Auto", icon: Monitor },
];

/** Dark (default), light for a bright workshop, or the device's own setting. Applied at once, remembered on this device */
export function ThemeSwitch({ initial, compact }: { initial: Theme; compact?: boolean }) {
  const [theme, setLocal] = useState(initial);
  const [, start] = useTransition();
  const router = useRouter();
  const choose = (t: Theme) => {
    setLocal(t);
    const html = document.documentElement;
    html.dataset.theme = t;
    html.classList.toggle("dark", t === "dark");
    start(async () => { await setTheme(t); router.refresh(); });
  };
  return (
    <div role="radiogroup" aria-label="Thème" data-testid="theme-switch" className="inline-flex rounded-lg border border-line bg-bg/50 p-0.5">
      {OPTIONS.map(({ key, label, icon: Icon }) => (
        <button key={key} type="button" role="radio" aria-checked={theme === key} title={label} onClick={() => choose(key)}
          className={`inline-flex items-center gap-1 rounded-md px-2 transition-colors ${compact ? "min-h-8 text-[11px]" : "min-h-10 text-sm"} ${
            theme === key ? "bg-accent/15 font-medium text-accent" : "text-muted hover:text-fg"}`}>
          <Icon size={compact ? 13 : 15} aria-hidden />{compact ? <span className="sr-only">{label}</span> : label}
        </button>
      ))}
    </div>
  );
}
