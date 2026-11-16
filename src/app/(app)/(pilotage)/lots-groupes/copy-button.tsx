"use client";

import { ClipboardCopy } from "lucide-react";
import { btn } from "@/components/ui";
import { useToast } from "@/components/toast";

/** Copies a ready-made text (the lot's title or description) to paste into Vinted */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const toast = useToast();
  return (
    <button type="button" className={btn.ghost} data-copy={label}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); toast(`${label} copié`, "ok"); }
        catch { toast("Copie impossible : sélectionnez le texte à la main", "error"); }
      }}>
      <ClipboardCopy size={15} /> Copier {label.toLowerCase()}
    </button>
  );
}
