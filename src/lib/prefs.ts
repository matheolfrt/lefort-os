import "server-only";
import { cookies } from "next/headers";

// Per-device display preferences, kept in cookies so the server renders the right theme and dashboard at once
// (no flash, nothing to migrate in the database). A phone and a computer can each have their own.

export type Theme = "dark" | "light" | "auto";
export const THEME_COOKIE = "lf_theme";
export const DASH_COOKIE = "lf_dash";

export async function getTheme(): Promise<Theme> {
  const v = (await cookies()).get(THEME_COOKIE)?.value;
  return v === "light" || v === "auto" ? v : "dark";
}

export interface DashLayout { order: string[]; hidden: string[] }

export async function getDashLayout(): Promise<DashLayout | null> {
  const raw = (await cookies()).get(DASH_COOKIE)?.value;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<DashLayout>;
    const ids = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === "string" && /^[a-z]{2,12}$/.test(x)).slice(0, 30) : []);
    return { order: ids(v.order), hidden: ids(v.hidden) };
  } catch { return null; }
}
