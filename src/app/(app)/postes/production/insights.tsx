"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Loader2, Play } from "lucide-react";
import { Stat, btn } from "@/components/ui";
import { COLUMN, PRIORITIES, TASK_COLUMNS, duration, perHour, type BoardStatus } from "@/lib/production";
import { call } from "./api";
import type { Overview } from "./production";

export interface Stats {
  total: { n: number; timed: number; secs: number };
  steps: { step: BoardStatus; n: number; timed: number; secs: number }[];
  people: { user_id: string; name: string; n: number; timed: number; secs: number; by_step: Partial<Record<BoardStatus, number>> }[];
  // managers only
  pending?: number;
  blocked?: number;
  cycle_secs?: number | null;
  columns?: { col: BoardStatus; n: number; wait_secs: number | null; per_day: number; backlog_days: number | null }[];
  bottleneck?: { col: BoardStatus; n: number; backlog_days: number | null } | null;
}

const rate = (r: number | null) => (r == null ? "—" : `${r.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} /h`);
const taskName = (s: BoardStatus) => `${COLUMN[s].taskEmoji ?? ""} ${COLUMN[s].task ?? COLUMN[s].label}`;

/** Start of the day in the browser's time zone (the shop works in France) */
export const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

/** The employee's home: their tasks by priority, what waits in their steps today, one button to start */
export function Welcome({ overview, firstName, myStats, onStart, collapsed, onToggle }: {
  overview: Overview;
  firstName: string;
  myStats: { n: number; timed: number; secs: number } | null;
  onStart: () => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pr = overview.priorities ?? { urgent: 0, high: 0, normal: 0, low: 0 };
  const counts = [pr.urgent, pr.high, pr.normal, pr.low];
  const mine = overview.columns.filter((c) => TASK_COLUMNS.includes(c));
  return (
    <section className="rounded-2xl border border-line bg-panel/80 p-4" aria-label="Mes tâches">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold">Bonjour {firstName || "à toi"} 👋</h2>
        <button type="button" onClick={onToggle} className="ml-auto flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs text-muted hover:text-fg" aria-expanded={!collapsed}>
          {collapsed ? "Afficher" : "Réduire"} <ChevronDown size={14} className={collapsed ? "" : "rotate-180"} />
        </button>
      </div>
      {!collapsed && (
        <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-[minmax(0,13rem)_minmax(0,15rem)_1fr] md:items-start">
          <div>
            <div className="eyebrow-tight mb-1.5 text-muted">Tes tâches</div>
            <ul className="space-y-1 text-sm">
              {PRIORITIES.map((p, i) => (
                <li key={p.value} className="flex items-center gap-2">
                  <span className={`size-2.5 rounded-full ${p.dot}`} />
                  <span className="w-8 figure font-semibold tabular-nums">{counts[i]}</span>
                  <span className="text-muted">{["urgentes", "prioritaires", "normales", "basses"][i]}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="eyebrow-tight mb-1.5 text-muted">Aujourd&apos;hui · à faire</div>
            <ul className="space-y-1 text-sm">
              {mine.map((c) => (
                <li key={c} className="flex items-center gap-2">
                  <span className="w-5 text-center">{COLUMN[c].taskEmoji}</span>
                  <span className="flex-1">{COLUMN[c].taskNoun}</span>
                  <span className="figure font-semibold tabular-nums">{overview.by_column?.[c] ?? 0}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="col-span-2 space-y-2 md:col-span-1 md:ml-auto md:w-72 md:self-center">
            <button type="button" onClick={onStart} className={btn.huge} data-testid="start-work">
              <Play size={20} /> COMMENCER LE TRAVAIL
            </button>
            <div className="text-center text-xs text-muted">
              Fait aujourd&apos;hui : <span className="font-semibold text-fg">{overview.done_today}</span>
              {myStats && myStats.timed > 0 && <> · {rate(perHour(myStats.timed, myStats.secs))}</>}
              {overview.assigned_to_me > 0 && <> · {overview.assigned_to_me} assigné{overview.assigned_to_me > 1 ? "s" : ""} à toi</>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const PERIODS = [
  { key: "today", label: "Aujourd'hui", from: startOfToday },
  { key: "7d", label: "7 jours", from: () => new Date(Date.now() - 7 * 86_400_000).toISOString() },
  { key: "30d", label: "30 jours", from: () => new Date(Date.now() - 30 * 86_400_000).toISOString() },
] as const;

/** 👑 Mode manager: output, speed, waiting work and the step that holds everything up */
export function ManagerPanel({ refreshKey }: { refreshKey: number }) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("today");
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const from = PERIODS.find((p) => p.key === period)!.from();
    call<Stats>("production_stats", { p_from: from }).then(({ data, error }) => {
      if (!live) return;
      setStats(data);
      setError(error?.message ?? null);
    });
    return () => { live = false; };
  }, [period, refreshKey]);

  const label = PERIODS.find((p) => p.key === period)!.label;
  const timedSteps = (stats?.steps ?? []).filter((s) => s.timed > 0);
  const slowest = timedSteps.sort((a, b) => b.secs / b.timed - a.secs / a.timed)[0];
  const stepRows = TASK_COLUMNS.map((col) => ({
    col,
    done: stats?.steps.find((s) => s.step === col),
    queue: stats?.columns?.find((c) => c.col === col),
  }));

  return (
    <section className="space-y-3 rounded-2xl border border-highlight/30 bg-panel/80 p-4" aria-label="Mode manager">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="eyebrow text-highlight">👑 Production · {label.toLowerCase()}</h2>
        <div className="ml-auto flex rounded-xl border border-line p-0.5 text-xs">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" onClick={() => setPeriod(p.key)} aria-pressed={period === p.key}
              className={`min-h-9 rounded-lg px-3 font-medium ${period === p.key ? "bg-panel-2 text-fg" : "text-muted hover:text-fg"}`}>{p.label}</button>
          ))}
        </div>
      </div>
      {error && <div className="text-sm text-red-300">{error}</div>}
      {!stats ? (
        <div className="flex h-24 items-center justify-center text-muted"><Loader2 className="animate-spin" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
            <Stat label="Articles traités" value={stats.total.n} hint={label} />
            <Stat label="En attente" value={stats.pending ?? "—"} hint="dans les étapes de travail" />
            <Stat label="Bloqués" value={stats.blocked ?? "—"} hint="bloqués ou en attente" />
            <Stat label="Productivité" value={rate(perHour(stats.total.timed, stats.total.secs))} hint="moyenne, temps mesuré" />
            <Stat label="Temps de cycle" value={duration(stats.cycle_secs)} hint="réception → en ligne (30 j)" />
            <Stat label="Étape la plus lente" value={<span className="text-lg">{slowest ? taskName(slowest.step) : "—"}</span>}
              hint={slowest ? `${duration(slowest.secs / slowest.timed)} / article` : "pas encore de mesure"} />
            <Stat label="Goulot d'étranglement" value={<span className="text-lg">{stats.bottleneck ? taskName(stats.bottleneck.col) : "—"}</span>}
              hint={stats.bottleneck ? `${stats.bottleneck.n} articles${stats.bottleneck.backlog_days != null ? ` · ≈ ${String(stats.bottleneck.backlog_days).replace(".", ",")} j de travail` : " · rien n'avance (7 j)"}` : "aucun retard"} />
          </div>

          <div className="grid gap-3 2xl:grid-cols-2">
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="data">
                <thead><tr><th>Étape</th><th className="num">Traités</th><th className="num">Temps moyen</th><th className="num">Art./h</th><th className="num">Temps total</th><th className="num">En file</th><th className="num">Attente</th></tr></thead>
                <tbody>
                  {stepRows.map(({ col, done, queue }) => (
                    <tr key={col} className={stats.bottleneck?.col === col ? "[&>td]:bg-highlight/[0.07]" : ""}>
                      <td className="whitespace-nowrap">{taskName(col)}</td>
                      <td className="num">{done?.n ?? 0}</td>
                      <td className="num">{done?.timed ? duration(done.secs / done.timed) : "—"}</td>
                      <td className="num">{done?.timed ? rate(perHour(done.timed, done.secs)) : "—"}</td>
                      <td className="num">{done?.secs ? duration(done.secs) : "—"}</td>
                      <td className="num">{queue?.n ?? 0}</td>
                      <td className="num">{duration(queue?.wait_secs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="data">
                <thead><tr><th>Employé</th><th className="num">Traités</th><th className="num">Art./h</th><th className="num">Temps moyen</th><th>Détail</th></tr></thead>
                <tbody>
                  {stats.people.length === 0 && <tr><td colSpan={5} className="text-center text-muted">Aucune tâche terminée sur la période.</td></tr>}
                  {stats.people.map((p) => (
                    <tr key={p.user_id}>
                      <td className="whitespace-nowrap font-medium">{p.name}</td>
                      <td className="num">{p.n}</td>
                      <td className="num">{p.timed ? rate(perHour(p.timed, p.secs)) : "—"}</td>
                      <td className="num">{p.timed ? duration(p.secs / p.timed) : "—"}</td>
                      <td className="text-xs text-muted">
                        {Object.entries(p.by_step).map(([s, n]) => `${COLUMN[s as BoardStatus]?.taskEmoji ?? ""} ${n}`).join("  ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-muted">
            Une tâche compte quand l&apos;article passe à l&apos;étape suivante. Le temps part de « Commencer », sinon de l&apos;action précédente de la même personne (au-delà de 20 min c&apos;est une pause, non comptée). Les changements groupés et synchronisations Vinted ne comptent pas.
          </p>
        </>
      )}
    </section>
  );
}
