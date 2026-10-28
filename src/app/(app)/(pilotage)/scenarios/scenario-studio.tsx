"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Copy, FilePlus2, Gauge, Save, Trash2 } from "lucide-react";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm";
import { Legend, MonthBars, MonthLine, type Series } from "@/components/charts";
import { btn, input } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";
import { FIELDS, PRESETS, capacityLevels, compute, funding, project, type ScenarioInputs } from "@/lib/scenario";
import type { Baseline } from "@/lib/scenario-baseline";

export interface SavedScenario { id: string; name: string; inputs: ScenarioInputs }

const euro0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const euro2 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = (v: number) => euro0.format(Math.round(v) || 0); // never "-0 €"
const eurC = (cents: number) => euro0.format(Math.round(cents / 100));
const num = (v: number) => Math.round(v).toLocaleString("fr-FR");
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1).replace(".", ",")} %`);
const tone = (v: number) => (v < 0 ? "text-red-300" : "");

const REAL = "__real__";

export function ScenarioStudio({ orgId, baseline, saved: initial }: { orgId: string; baseline: Baseline; saved: SavedScenario[] }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [saved, setSaved] = useState(initial);
  const [current, setCurrent] = useState<{ id: string | null; name: string; inputs: ScenarioInputs }>(
    () => ({ id: null, name: "Mes chiffres réels", inputs: baseline.inputs }));
  const [source, setSource] = useState<string>(REAL);
  const [busy, setBusy] = useState(false);

  const r = useMemo(() => compute(current.inputs), [current.inputs]);
  const fund = useMemo(() => funding(current.inputs), [current.inputs]);
  const months = useMemo(() => project(current.inputs), [current.inputs]);
  const real = useMemo(() => compute(baseline.inputs), [baseline.inputs]);
  const original = source === REAL ? baseline.inputs : saved.find((s) => s.id === source)?.inputs;
  const dirty = !original || JSON.stringify(original) !== JSON.stringify(current.inputs)
    || (source !== REAL && saved.find((s) => s.id === source)?.name !== current.name);

  const set = (key: keyof ScenarioInputs, value: string) => {
    const v = Number(value.replace(",", "."));
    setCurrent((c) => ({ ...c, inputs: { ...c.inputs, [key]: Number.isFinite(v) ? v : 0 } }));
  };
  const load = (s: SavedScenario | null) => {
    if (s) { setCurrent({ id: s.id, name: s.name, inputs: s.inputs }); setSource(s.id); }
    else { setCurrent({ id: null, name: "Mes chiffres réels", inputs: baseline.inputs }); setSource(REAL); }
  };

  async function save() {
    const name = current.name.trim() || "Scénario sans nom";
    setBusy(true);
    const db = supabaseBrowser();
    const { data, error } = current.id
      ? await db.from("scenarios").update({ name, inputs: current.inputs }).eq("id", current.id).select("id").single()
      : await db.from("scenarios").insert({ org_id: orgId, name, inputs: current.inputs }).select("id").single();
    setBusy(false);
    if (error || !data) return toast(error ? errorMessage(error) : "Enregistrement impossible", "error");
    const entry = { id: data.id as string, name, inputs: current.inputs };
    setSaved((list) => (list.some((s) => s.id === entry.id) ? list.map((s) => (s.id === entry.id ? entry : s)) : [...list, entry]));
    setCurrent((c) => ({ ...c, id: entry.id, name }));
    setSource(entry.id);
    toast("Scénario enregistré", "ok");
    router.refresh();
  }
  function duplicate() {
    setCurrent((c) => ({ id: null, name: `${c.name} (copie)`, inputs: { ...c.inputs } }));
    setSource("");
  }
  function preset(p: (typeof PRESETS)[number]) {
    setCurrent({ id: null, name: p.label, inputs: p.apply(baseline.inputs) });
    setSource(`preset:${p.key}`);
  }
  function blank() {
    setCurrent({ id: null, name: "Nouveau scénario", inputs: { ...baseline.inputs } });
    setSource("");
  }
  async function remove() {
    if (!current.id) return;
    const ok = await confirm({ title: `Supprimer « ${current.name} » ?`, danger: true, confirmLabel: "Supprimer" });
    if (!ok) return;
    const { error } = await supabaseBrowser().from("scenarios").delete().eq("id", current.id);
    if (error) return toast(errorMessage(error), "error");
    setSaved((list) => list.filter((s) => s.id !== current.id));
    load(null);
    toast("Scénario supprimé", "ok");
  }

  const money: Series[] = [
    { label: "Chiffre d'affaires", color: "series-1", values: months.map((m) => Math.round(m.revenue * 100)) },
    { label: "Résultat net", color: "series-2", values: months.map((m) => Math.round(m.net * 100)) },
  ];
  const cash: Series = { label: "Trésorerie cumulée", color: "series-1", values: months.map((m) => Math.round(m.cash * 100)) };
  const groups = [...new Set(FIELDS.map((f) => f.group))];
  const year = months.reduce((a, m) => ({ revenue: a.revenue + m.revenue, net: a.net + m.net }), { revenue: 0, net: 0 });

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-highlight">Simulation</p>
          <h1 className="mt-1 text-3xl font-bold leading-tight tracking-[-0.04em] sm:text-[40px]">Scénarios</h1>
          <p className="max-w-2xl text-sm text-muted">Modélisez l&apos;activité : stock, prix, vitesse de vente, équipe, charges. Partez de vos chiffres réels, changez une hypothèse et voyez l&apos;effet sur le résultat.</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">
          <button className={btn.secondary} onClick={blank}><FilePlus2 size={16} /> Nouveau</button>
          <button className={btn.secondary} onClick={duplicate}><Copy size={16} /> Dupliquer</button>
          <button className={btn.primary} onClick={save} disabled={busy || (!dirty && !!current.id)}>
            <Save size={16} /> {current.id ? (dirty ? "Enregistrer" : "Enregistré") : "Enregistrer"}
          </button>
        </div>
      </header>

      {/* Saved scenarios */}
      <nav aria-label="Scénarios" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul className="flex min-w-max gap-2 md:min-w-0 md:flex-wrap">
          <ScenarioChip active={source === REAL} name="Mes chiffres réels" net={real.net} real onClick={() => load(null)} />
          {saved.map((s) => (
            <ScenarioChip key={s.id} active={source === s.id} name={s.name} net={compute(s.inputs).net} onClick={() => load(s)} />
          ))}
        </ul>
      </nav>

      {/* Starting points around the real figures */}
      <div className="flex flex-wrap items-center gap-2" data-testid="presets">
        <span className="text-sm text-muted">Partir d&apos;un scénario type :</span>
        {PRESETS.map((p) => (
          <button key={p.key} type="button" onClick={() => preset(p)} title={p.change} aria-pressed={source === `preset:${p.key}`}
            className={`inline-flex min-h-10 items-center rounded-lg border px-3 text-sm transition ${source === `preset:${p.key}` ? "border-accent/50 bg-accent/10 text-accent" : "border-line hover:border-fg/25"}`}>
            {p.label}
          </button>
        ))}
        {source.startsWith("preset:") && <span className="text-xs text-muted">{PRESETS.find((p) => `preset:${p.key}` === source)?.change} · enregistrez-le pour le garder</span>}
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi label="CA / mois" value={eur(r.revenue)} hint={`≈ ${eur(r.annualRevenue)} / an`} />
        <Kpi label="Résultat net / mois" value={eur(r.net)} hint={`${pct(r.marginPct)} du CA`} bad={r.net < 0} />
        <Kpi label="Ventes / mois" value={num(r.sales)} hint={r.daysToSell ? `≈ ${Math.round(r.daysToSell)} j en stock` : "—"} />
        <Kpi label="Stock immobilisé" value={eur(r.capital)} hint="au prix d'achat" />
        <Kpi label="Achats / mois" value={eur(r.cogs)} hint="pour garder ce stock" />
        <Kpi label="Point mort" value={r.breakevenSales == null ? "—" : `${Math.ceil(r.breakevenSales)} ventes`}
          hint={r.breakevenStock == null ? "par mois" : `soit ${num(r.breakevenStock)} articles en stock`} />
        <Kpi label="Cash nécessaire" value={eur(fund.cashNeeded)}
          hint={`stock ${eur(r.capital)} + 1 mois de charges ${eur(r.fixed)}${fund.dip > 0 ? ` + creux ${eur(fund.dip)}` : ""}`} />
        <Kpi label="Retour sur capital" value={pct(fund.rocPct)}
          hint={fund.velocity == null ? "résultat annuel / cash nécessaire" : `vélocité ${fund.velocity.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} € de marge / € de stock / an`} />
      </div>

      {r.warnings.length > 0 && (
        <ul className="space-y-1.5">
          {r.warnings.map((w) => (
            <li key={w.text} className={`flex items-start gap-2 rounded-xl px-3 py-2 text-sm ring-1 ring-inset ${
              w.tone === "bad" ? "bg-red-500/10 text-red-200 ring-red-400/30" : "bg-amber-500/10 text-amber-200 ring-amber-400/30"}`}>
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {w.text}
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* Inputs */}
        <section className="h-fit space-y-4 rounded-2xl border border-line bg-panel/80 p-4 lg:sticky lg:top-4">
          <label className="block">
            <span className="eyebrow-tight mb-1.5 block text-muted">Nom du scénario</span>
            <input className={input} value={current.name} onChange={(e) => setCurrent((c) => ({ ...c, name: e.target.value }))} />
          </label>
          {groups.map((g) => (
            <fieldset key={g} className="space-y-2">
              <legend className="eyebrow mb-2 text-highlight">{g}</legend>
              {FIELDS.filter((f) => f.group === g).map((f) => {
                const realValue = baseline.inputs[f.key];
                const differs = current.inputs[f.key] !== realValue;
                return (
                  <label key={f.key} className="grid grid-cols-[1fr_7.5rem] items-center gap-2">
                    <span className="min-w-0 text-sm">
                      {f.label}
                      <span className="block text-[11px] text-muted">
                        {f.unit}
                        {differs && <button type="button" className="ml-1.5 underline decoration-dotted underline-offset-2 hover:text-fg"
                          onClick={(e) => { e.preventDefault(); set(f.key, String(realValue)); }}>réel : {realValue.toLocaleString("fr-FR")}</button>}
                      </span>
                    </span>
                    <input className={`${input} text-right font-mono tabular-nums`} type="number" inputMode="decimal" step={f.step ?? 1} min={0}
                      value={current.inputs[f.key]} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label} title={f.hint} />
                  </label>
                );
              })}
            </fieldset>
          ))}
          <p className="text-xs text-muted">Chiffres réels calculés sur : {baseline.basis.join(" · ")}.</p>
          {current.id && (
            <button className="inline-flex min-h-11 items-center gap-2 text-sm text-red-300 hover:underline" onClick={remove}>
              <Trash2 size={16} /> Supprimer ce scénario
            </button>
          )}
        </section>

        {/* Results */}
        <div className="min-w-0 space-y-4">
          <section className="rounded-2xl border border-line bg-panel/80 p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="font-semibold">Projection sur 12 mois</h2>
                <p className="text-xs text-muted">
                  {current.inputs.growth ? `Stock +${current.inputs.growth} % par mois : ${num(current.inputs.stock)} → ${num(months.at(-1)!.stock)} articles. ` : "Stock constant. "}
                  Sur 12 mois : {eur(year.revenue)} de CA, {eur(year.net)} de résultat.
                </p>
              </div>
              <Legend series={money} />
            </div>
            <MonthBars wide months={months.map((m) => m.month)} series={money} format={eurC}
              extra={(i) => <div className="mt-1 border-t border-line pt-1 text-muted">{num(months[i].stock)} articles en stock · achats {eur(months[i].buying)}</div>} />
          </section>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <section className="rounded-2xl border border-line bg-panel/80 p-4">
              <h2 className="mb-1 font-semibold">Compte de résultat</h2>
              <p className="mb-3 text-xs text-muted">Par mois, au niveau de stock choisi</p>
              <table className="w-full text-sm">
                <tbody>
                  {[
                    ["Chiffre d'affaires", r.revenue, true],
                    ["Achat des articles vendus", -r.cogs],
                    ["Frais de plateforme", -r.fees],
                    ["Emballage et port", -r.perSaleCosts],
                    ["Marge après frais", r.gross, true],
                    ["Cotisations URSSAF", -r.urssaf],
                    ["Salaires", -r.payroll],
                    ["Local", -current.inputs.rent],
                    ["Autres charges fixes", -current.inputs.otherFixed],
                    ["Résultat net (avant impôt sur le revenu)", r.net, true],
                  ].map(([label, v, strong]) => (
                    <tr key={label as string} className={strong ? "border-t border-line font-semibold" : "text-muted"}>
                      <td className="py-1.5 pr-2">{label as string}</td>
                      <td className={`py-1.5 text-right font-mono tabular-nums ${strong ? tone(v as number) : ""}`}>{eur(v as number)}</td>
                      <td className="w-14 py-1.5 text-right text-xs tabular-nums text-muted">{r.revenue > 0 && label !== "Chiffre d'affaires" ? `${Math.round(Math.abs(v as number) / r.revenue * 100)} %` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <Mini label="Résultat sur 12 mois" value={eur(r.annualNet)} bad={r.annualNet < 0} />
                <Mini label="Rendement du stock" value={pct(r.roiPct)} hint="résultat annuel / stock immobilisé" />
              </div>
            </section>

            <section className="space-y-4">
              <div className="rounded-2xl border border-line bg-panel/80 p-4">
                <h2 className="mb-1 font-semibold">Par article vendu</h2>
                <p className="mb-3 text-xs text-muted">Ce qu&apos;une vente rapporte une fois ses coûts payés</p>
                <div className="grid grid-cols-2 gap-2">
                  <Mini label="Prix de vente" value={euro2.format(current.inputs.price)} />
                  <Mini label="Coût d'achat" value={euro2.format(current.inputs.cost)} />
                  <Mini label="Frais + port" value={euro2.format(current.inputs.price * current.inputs.feePct / 100 + current.inputs.feeFixed + current.inputs.perSale)} />
                  <Mini label="Cotisations" value={euro2.format(current.inputs.price * current.inputs.urssafPct / 100)} />
                  <Mini label="Reste par vente" value={euro2.format(r.contribution)} bad={r.contribution <= 0} strong />
                  <Mini label="Multiple" value={current.inputs.cost ? `× ${(current.inputs.price / current.inputs.cost).toFixed(1).replace(".", ",")}` : "—"} hint="prix / coût" />
                </div>
              </div>
              <div className="rounded-2xl border border-line bg-panel/80 p-4">
                <h2 className="mb-1 flex items-center gap-2 font-semibold"><Gauge size={16} /> Équipe</h2>
                <p className="text-sm text-muted">
                  {num(r.sales)} articles à traiter par mois, soit <b className="text-fg">{r.peopleNeeded} personne{r.peopleNeeded > 1 ? "s" : ""}</b> à
                  {" "}{num(current.inputs.capacity)} articles chacune. Équipe actuelle : {r.team}.
                </p>
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-line bg-panel/80 p-4">
            <h2 className="mb-1 font-semibold">Trésorerie cumulée</h2>
            <p className="mb-3 text-xs text-muted">Résultat de chaque mois, moins l&apos;achat du stock supplémentaire quand il grandit</p>
            <MonthLine wide months={months.map((m) => m.month)} series={cash} format={eurC} />
          </section>

          <section className="rounded-2xl border border-line bg-panel/80 p-4">
            <h2 className="mb-1 font-semibold">Et si le stock changeait ?</h2>
            <p className="mb-3 text-xs text-muted">Mêmes hypothèses, autres niveaux de stock</p>
            <div className="-mx-4 overflow-x-auto">
              <table className="data">
                <thead><tr><th className="num">Stock</th><th className="num">Ventes / mois</th><th className="num">CA / mois</th><th className="num">Stock immobilisé</th><th className="num">Équipe</th><th className="num">Résultat / mois</th></tr></thead>
                <tbody>
                  {capacityLevels(current.inputs.stock).map((stock) => {
                    const c = compute({ ...current.inputs, stock });
                    const mine = stock === Math.round(current.inputs.stock);
                    return (
                      <tr key={stock} className={mine ? "bg-accent/8 font-semibold" : ""}>
                        <td className="num">{num(stock)}{mine && <span className="ml-1 text-xs text-accent">●</span>}</td>
                        <td className="num">{num(c.sales)}</td>
                        <td className="num">{eur(c.revenue)}</td>
                        <td className="num">{eur(c.capital)}</td>
                        <td className="num">{c.peopleNeeded}</td>
                        <td className={`num ${tone(c.net)}`}>{eur(c.net)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-panel/80 p-4">
            <h2 className="mb-1 font-semibold">Comparer les scénarios</h2>
            <p className="mb-3 text-xs text-muted">Touchez une ligne pour l&apos;ouvrir</p>
            <div className="-mx-4 overflow-x-auto">
              <table className="data">
                <thead><tr><th>Scénario</th><th className="num">Stock</th><th className="num">CA / mois</th><th className="num">Résultat / mois</th><th className="num">Marge</th><th className="num">Stock immobilisé</th><th className="num">Cash nécessaire</th><th className="num">Retour</th><th className="num">Équipe</th></tr></thead>
                <tbody>
                  {[{ id: REAL, name: "Mes chiffres réels", inputs: baseline.inputs },
                    ...PRESETS.filter((p) => p.key !== "base").map((p) => ({ id: `preset:${p.key}`, name: p.label, inputs: p.apply(baseline.inputs) })),
                    ...saved].map((s) => {
                    const c = compute(s.id === source ? current.inputs : s.inputs);
                    const fd = funding(s.id === source ? current.inputs : s.inputs);
                    const pr = PRESETS.find((p) => `preset:${p.key}` === s.id);
                    return (
                      <tr key={s.id} className={`cursor-pointer ${s.id === source ? "bg-accent/8" : ""}`} data-scenario={s.name}
                        onClick={() => (pr ? preset(pr) : load(s.id === REAL ? null : (s as SavedScenario)))}>
                        <td className="font-medium">{s.id === source ? current.name : s.name}{s.id === source && dirty && <span className="ml-1 text-xs text-highlight">modifié</span>}</td>
                        <td className="num">{num((s.id === source ? current.inputs : s.inputs).stock)}</td>
                        <td className="num">{eur(c.revenue)}</td>
                        <td className={`num font-semibold ${tone(c.net)}`}>{eur(c.net)}</td>
                        <td className="num">{pct(c.marginPct)}</td>
                        <td className="num">{eur(c.capital)}</td>
                        <td className="num">{eur(fd.cashNeeded)}</td>
                        <td className="num">{pct(fd.rocPct)}</td>
                        <td className="num">{c.peopleNeeded}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">Conservateur et Agressif partent de vos chiffres réels ({PRESETS.filter((p) => p.key !== "base").map((p) => `${p.label.toLowerCase()} : ${p.change}`).join(" ; ")}). Ce sont des hypothèses, pas des prévisions.</p>
            {!saved.length && <p className="mt-3 text-sm text-muted">Enregistrez un scénario pour le comparer à vos chiffres réels.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

function ScenarioChip({ name, net, active, real, onClick }: { name: string; net: number; active: boolean; real?: boolean; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} aria-current={active ? "true" : undefined}
        className={`flex min-h-14 min-w-44 flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition ${
          active ? "border-accent/50 bg-accent/10" : "border-line bg-panel/70 hover:border-fg/25"}`}>
        <span className="flex items-center gap-1.5 text-sm font-semibold">{real && <span className="size-2 rounded-full bg-accent" />}{name}</span>
        <span className={`font-mono text-xs tabular-nums ${net < 0 ? "text-red-300" : "text-muted"}`}>{eur(net)} / mois</span>
      </button>
    </li>
  );
}

function Kpi({ label, value, hint, bad }: { label: string; value: string; hint: string; bad?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/80 px-4 py-3">
      <div className="eyebrow-tight leading-tight text-muted">{label}</div>
      <div className={`mt-1.5 font-mono text-[22px] font-semibold leading-tight tabular-nums tracking-tight sm:text-[26px] ${bad ? "text-red-300" : ""}`}>{value}</div>
      <div className="text-xs text-muted">{hint}</div>
    </div>
  );
}

function Mini({ label, value, hint, bad, strong }: { label: string; value: string; hint?: string; bad?: boolean; strong?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${strong ? "border-accent/40 bg-accent/8" : "border-line bg-bg/40"}`}>
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`font-mono font-semibold tabular-nums ${bad ? "text-red-300" : ""}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted">{hint}</div>}
    </div>
  );
}
