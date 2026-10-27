"use client";

import { useEffect, useRef, useState } from "react";
import { StatusChip } from "./ui";
import { HOLD_LABEL } from "@/i18n/fr";
import { STATUS_TARGETS } from "@/lib/item-edits";
import type { HoldReason, ItemStatus } from "@/lib/types";

/** A table cell that turns into a field on click: Enter or leaving the field saves, Échap cancels */
export function InlineEdit({ value, display, label, onSave, disabled, list, upper, mono, align, inputMode }: {
  value: string; display: string; label: string; onSave: (v: string) => void; disabled?: boolean;
  list?: string; upper?: boolean; mono?: boolean; align?: "right"; inputMode?: "decimal";
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const done = useRef(false);
  useEffect(() => { if (!editing) setText(value); }, [value, editing]);
  if (!editing) {
    return (
      <button type="button" disabled={disabled} aria-label={label} title="Cliquer pour modifier"
        onClick={() => { done.current = false; setEditing(true); }}
        className={`-mx-2 -my-1 min-h-9 rounded-lg border border-transparent px-2 transition hover:border-line hover:bg-fg/5 ${align === "right" ? "text-right" : "text-left"} ${mono ? "font-mono" : ""}`}>
        {display}
      </button>
    );
  }
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    if (save && text.trim() !== value.trim()) onSave(text.trim());
  };
  return (
    <input autoFocus aria-label={label} list={list} inputMode={inputMode} value={text}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(upper ? e.target.value.toUpperCase() : e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); }}
      onBlur={() => finish(true)}
      className={`-mx-2 -my-1 h-9 w-28 rounded-lg border border-accent bg-bg px-2 text-sm outline-none ring-2 ring-accent/25 ${align === "right" ? "text-right" : ""} ${mono ? "font-mono" : ""}`} />
  );
}

/** The status pill opens the list of statuses a person may set ("on_hold:<reason>" for a hold) */
export function StatusPicker({ sku, status, onPick, disabled }: { sku: string; status: ItemStatus; onPick: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="relative inline-flex cursor-pointer items-center rounded-full transition hover:ring-2 hover:ring-fg/15" title="Cliquer pour changer le statut">
      <StatusChip status={status} />
      <select aria-label={`Statut de ${sku}`} value="" disabled={disabled} onChange={(e) => e.target.value && onPick(e.target.value)}
        className="absolute inset-0 cursor-pointer appearance-none opacity-0">
        <option value="">Changer le statut…</option>
        {STATUS_TARGETS.filter((t) => t.value !== status && t.value !== "on_hold" && (t.value !== "release" || status === "on_hold"))
          .map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        {status !== "on_hold" && (Object.keys(HOLD_LABEL) as HoldReason[]).map((h) => <option key={h} value={`on_hold:${h}`}>En attente · {HOLD_LABEL[h]}</option>)}
      </select>
    </label>
  );
}
