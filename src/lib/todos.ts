// To-dos: dates in the Paris calendar, grouping by when they are due, and quick typing
// (« Appeler Fripes & Co demain ! », « Faire la compta chaque lundi »).

export type Repeat = "none" | "daily" | "weekly" | "monthly";
export interface Todo {
  id: string;
  title: string;
  notes: string | null;
  due_on: string | null; // YYYY-MM-DD
  important: boolean;
  assigned_to: string | null;
  repeat: Repeat;
  done_at: string | null;
  done_by: string | null;
  created_by: string | null;
  created_at: string;
}
export const TODO_COLUMNS = "id, title, notes, due_on, important, assigned_to, repeat, done_at, done_by, created_by, created_at";

export const REPEAT_LABEL: Record<Repeat, string> = { none: "Une fois", daily: "Chaque jour", weekly: "Chaque semaine", monthly: "Chaque mois" };

import { parisToday } from "@/lib/format";
export { parisToday };

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = (day: string) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
const diffDays = (a: string, b: string) => Math.round((new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 86_400_000);

export type Bucket = "late" | "today" | "tomorrow" | "week" | "later" | "none";
export const BUCKET_LABEL: Record<Bucket, string> = {
  late: "En retard", today: "Aujourd'hui", tomorrow: "Demain", week: "Cette semaine", later: "Plus tard", none: "Sans date",
};
export const BUCKETS: Bucket[] = ["late", "today", "tomorrow", "week", "later", "none"];

export function bucket(t: Pick<Todo, "due_on">, today: string): Bucket {
  if (!t.due_on) return "none";
  const d = diffDays(t.due_on, today);
  if (d < 0) return "late";
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  return d <= 6 - weekday(today) ? "week" : "later";
}

const dayFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export function dueLabel(due: string | null, today: string): string {
  if (!due) return "";
  const d = diffDays(due, today);
  if (d === 0) return "Aujourd'hui";
  if (d === 1) return "Demain";
  if (d === -1) return "Hier";
  if (d < 0) return `En retard de ${-d} j`;
  return dayFmt.format(new Date(`${due}T12:00:00Z`));
}

/**
 * Date a repeating to-do comes back once done: one step after its date, and after today if it was late, keeping its
 * rhythm (same rule as the database)
 */
export function nextDue(t: Pick<Todo, "due_on" | "repeat">, today: string): string | null {
  if (t.repeat === "none") return null;
  const step = (d: string) => {
    if (t.repeat === "daily") return addDays(d, 1);
    if (t.repeat === "weekly") return addDays(d, 7);
    const x = new Date(`${d}T12:00:00Z`), day = x.getUTCDate();
    const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 2, 0)).getUTCDate();
    return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, Math.min(day, last), 12)).toISOString().slice(0, 10);
  };
  let d = step(t.due_on ?? today);
  while (d <= today) d = step(d);
  return d;
}

/** Sort: important first, then by date (no date last), then oldest created */
export function sortTodos(list: Todo[]): Todo[] {
  return [...list].sort((a, b) =>
    Number(b.important) - Number(a.important)
    || (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999")
    || a.created_at.localeCompare(b.created_at));
}

const DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Reads the date, repeat and « ! » typed at the end of a to-do:
 * « … demain », « … aujourd'hui », « … vendredi », « … chaque jour / chaque lundi / chaque mois », « … ! ».
 */
export function parseQuick(input: string, today: string): { title: string; due_on: string | null; repeat: Repeat; important: boolean } {
  let title = input.normalize("NFC").trim();
  let due_on: string | null = null, repeat: Repeat = "none", important = false;
  for (let guard = 0; guard < 4; guard++) {
    const f = fold(title);
    let m: RegExpMatchArray | null;
    if (/\s*!+$/.test(title)) { important = true; title = title.replace(/\s*!+$/, ""); continue; }
    if ((m = f.match(/\s+(?:chaque jour|tous les jours)$/))) { repeat = "daily"; due_on ??= today; }
    else if ((m = f.match(/\s+(?:chaque semaine|toutes les semaines)$/))) { repeat = "weekly"; due_on ??= today; }
    else if ((m = f.match(/\s+(?:chaque mois|tous les mois)$/))) { repeat = "monthly"; due_on ??= today; }
    else if ((m = f.match(new RegExp(`\\s+(?:chaque|tous les) (${DAYS.join("|")})s?$`)))) {
      repeat = "weekly";
      const target = DAYS.indexOf(m[1]);
      due_on = addDays(today, (target - weekday(today) + 7) % 7);
    }
    else if ((m = f.match(/\s+(?:aujourd'hui|aujourd’hui|auj)$/))) due_on = today;
    else if ((m = f.match(/\s+apres-demain$/))) due_on = addDays(today, 2);
    else if ((m = f.match(/\s+demain$/))) due_on = addDays(today, 1);
    else if ((m = f.match(new RegExp(`\\s+(${DAYS.join("|")})$`)))) {
      const target = DAYS.indexOf(m[1]);
      due_on = addDays(today, ((target - weekday(today) + 7) % 7) || 7);
    }
    if (!m) break;
    title = title.slice(0, title.length - m[0].length);
  }
  return { title: title.trim(), due_on, repeat, important };
}
