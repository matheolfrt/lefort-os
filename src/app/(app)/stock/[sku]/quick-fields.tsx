"use client";

import { useRouter } from "next/navigation";
import { InlineEdit, StatusPicker } from "@/components/inline-edit";
import { StatusChip } from "@/components/ui";
import { useToast } from "@/components/toast";
import { eurosInput, money } from "@/lib/format";
import { moveTo, parsePrice, restorePrice, restoreStatuses, setPrice, setStatus } from "@/lib/item-edits";
import { supabaseBrowser } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";
import type { ItemStatus } from "@/lib/types";

/** The fields changed most often, editable in place, each change with « Annuler » */
export function QuickFields({ item, location, locations, editable }: {
  item: { id: string; sku: string; status: ItemStatus; list_price_cents: number | null; min_price_cents: number | null };
  location: string | null;
  locations: { code: string; label: string | null }[];
  editable: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  async function change(text: string, action: () => Promise<unknown>, undo?: () => Promise<unknown>) {
    try {
      const r = await action();
      const refused = (r as { errors?: { error: string }[] } | undefined)?.errors ?? [];
      if (refused.length) { toast(refused[0].error, "error"); return; }
      toast(text, "ok", undo ? { action: { label: "Annuler", run: async () => {
        try { await undo(); toast("Modification annulée", "info"); } catch (e) { toast((e as Error).message, "error"); }
        router.refresh();
      } } } : undefined);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const loc = location?.replace("EMP-", "") ?? "";
  return (
    <dl className="divide-y divide-line text-sm">
      <Row label="Statut">
        {editable ? <StatusPicker sku={item.sku} status={item.status} onPick={(v) => {
          const [target, hold] = v.split(":");
          change("Statut mis à jour", () => setStatus([item.id], target as ItemStatus | "release", { holdReason: hold }),
            item.status === "on_hold" ? undefined : () => restoreStatuses([{ id: item.id, status: item.status }]));
        }} /> : <StatusChip status={item.status} />}
      </Row>
      <Row label="Prix affiché">
        {editable ? <InlineEdit value={eurosInput(item.list_price_cents)} display={money(item.list_price_cents)} label="Prix affiché" align="right" inputMode="decimal"
          onSave={(v) => {
            const cents = v ? parsePrice(v) : null;
            if (v && cents == null) return toast("Prix invalide", "error");
            change(`Prix : ${money(item.list_price_cents)} → ${money(cents)}`, () => setPrice(item.id, cents, item.min_price_cents),
              () => restorePrice(item.id, item.list_price_cents, item.min_price_cents));
          }} /> : money(item.list_price_cents)}
      </Row>
      <Row label="Prix minimum accepté">
        {editable ? <InlineEdit value={eurosInput(item.min_price_cents)} display={money(item.min_price_cents)} label="Prix minimum" align="right" inputMode="decimal"
          onSave={(v) => {
            const cents = v ? parsePrice(v) : null;
            if (v && cents == null) return toast("Prix invalide", "error");
            if (cents != null && item.list_price_cents != null && cents > item.list_price_cents) return toast("Le minimum ne peut pas dépasser le prix affiché", "error");
            change("Prix minimum mis à jour", async () => {
              const { error } = await supabaseBrowser().from("items").update({ min_price_cents: cents }).eq("id", item.id);
              if (error) throw new Error(errorMessage(error));
            }, () => restorePrice(item.id, item.list_price_cents, item.min_price_cents));
          }} /> : money(item.min_price_cents)}
      </Row>
      <Row label="Emplacement">
        {editable ? <InlineEdit value={loc} display={loc || "—"} label="Emplacement" list="item-locations" upper mono
          onSave={(v) => v && change(`Rangé en ${v}`, () => moveTo(item.id, v), location ? () => moveTo(item.id, location) : undefined)} /> : (loc || "—")}
        <datalist id="item-locations">{locations.map((l) => <option key={l.code} value={l.code.replace("EMP-", "")}>{l.label ?? ""}</option>)}</datalist>
      </Row>
    </dl>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 py-1">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{children}</dd>
    </div>
  );
}
