"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { btn, chip, input } from "@/components/ui";
import { parseEuros } from "@/lib/format";
import { judgeLot, type LotVerdict } from "@/lib/kpi/compute";

// « Juger un lot » : the pieces of a lot seen on Fleek (or elsewhere), counted by type or brand, against what those
// pieces really sold for here. The verdict follows the rule of the quarter (pay at most ¼ of the resale).

export interface LotRef { key: string; label: string; group: string; avgPrice: number; sold: number }

const euro0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur = (c: number) => euro0.format(Math.round(c / 100));

const VERDICT: Record<LotVerdict, { label: string; tone: string }> = {
  bon: { label: "Bon achat", tone: "bg-accent/15 text-accent ring-accent/30" },
  correct: { label: "Correct si ça part vite", tone: "bg-amber-400/10 text-amber-300 ring-amber-400/25" },
  cher: { label: "Trop cher", tone: "bg-red-500/15 text-red-300 ring-red-400/30" },
  vide: { label: "À compléter", tone: "bg-fg/5 text-muted ring-line" },
};

interface Line { id: number; ref: string; qty: string }

export function LotCheck({ refs }: { refs: LotRef[] }) {
  const [lines, setLines] = useState<Line[]>([{ id: 1, ref: refs[0]?.key ?? "", qty: "10" }]);
  const [price, setPrice] = useState("");
  const [extra, setExtra] = useState("0");
  const byKey = useMemo(() => new Map(refs.map((r) => [r.key, r])), [refs]);
  const groups = useMemo(() => [...new Set(refs.map((r) => r.group))], [refs]);

  const priceCents = parseEuros(price) ?? 0;
  const j = judgeLot(lines.map((l) => ({ avgPrice: byKey.get(l.ref)?.avgPrice ?? null, qty: Number(l.qty) || 0 })), priceCents, Number(extra.replace(",", ".")) || 0);
  const v = priceCents ? j.verdict : "vide";
  const set = (id: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  if (!refs.length) return <p className="text-sm text-muted">Il faut quelques ventes enregistrées pour estimer un lot.</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-2">
        <p className="text-sm text-muted">Compte les pièces du lot par type ou par marque, puis indique son prix livré.</p>
        <ul className="space-y-2" aria-label="Pièces du lot">
          {lines.map((l, n) => (
            <li key={l.id} className="flex items-center gap-2">
              <select className={`${input} min-w-0 flex-1`} value={l.ref} onChange={(e) => set(l.id, { ref: e.target.value })} aria-label={`Type de la ligne ${n + 1}`}>
                {groups.map((g) => (
                  <optgroup key={g} label={g}>
                    {refs.filter((r) => r.group === g).map((r) => (
                      <option key={r.key} value={r.key}>{r.label} · {eur(r.avgPrice)}{r.sold < 5 ? ` (${r.sold} vente${r.sold > 1 ? "s" : ""})` : ""}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="w-20 shrink-0">
                <input className={`${input} text-right tabular-nums`} inputMode="numeric" value={l.qty} aria-label={`Nombre de pièces de la ligne ${n + 1}`}
                  onChange={(e) => set(l.id, { qty: e.target.value.replace(/[^\d]/g, "").slice(0, 4) })} />
              </span>
              <button type="button" className={btn.icon} aria-label={`Retirer la ligne ${n + 1}`} disabled={lines.length === 1}
                onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}><X size={18} /></button>
            </li>
          ))}
        </ul>
        <button type="button" className={btn.ghost}
          onClick={() => setLines((ls) => [...ls, { id: Math.max(...ls.map((x) => x.id)) + 1, ref: refs[0].key, qty: "1" }])}>
          <Plus size={16} /> Ajouter un type
        </button>
        <div className="grid grid-cols-2 gap-2 pt-2">
          <label className="block">
            <span className="eyebrow-tight mb-1.5 block text-muted">Prix du lot livré (€)</span>
            <input className={`${input} tabular-nums`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="450" />
          </label>
          <label className="block">
            <span className="eyebrow-tight mb-1.5 block text-muted">Douane et taxes (%)</span>
            <input className={`${input} tabular-nums`} inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="0" />
          </label>
        </div>
      </div>

      <div className="rounded-2xl bg-[var(--fill)] p-4" aria-live="polite">
        <span className={`${chip} ${VERDICT[v].tone}`}>{VERDICT[v].label}</span>
        <dl className="mt-3 space-y-1.5 text-sm">
          <Row label="Pièces" value={String(j.pieces)} />
          <Row label="Revente estimée" value={eur(j.revenue)} />
          <Row label="Coût du lot" value={priceCents ? eur(j.cost) : "—"} />
          <Row label="Part de la revente" value={j.ratio == null || !priceCents ? "—" : `${Math.round(j.ratio * 100)} %`} />
          <Row label="Reste après achat" value={priceCents ? eur(j.profit) : "—"} strong />
        </dl>
        <p className="mt-3 border-t border-line pt-3 text-sm">
          Prix max conseillé : <strong className="text-accent">{eur(j.maxPrice)}</strong>
          <span className="block text-xs text-muted">¼ de la revente estimée{Number(extra) ? ", douane déduite" : ""}.</span>
        </p>
        <p className="mt-2 text-xs text-muted">Estimé sur tes prix moyens de vente. Une pièce abîmée vaut moins : compte large.</p>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}
