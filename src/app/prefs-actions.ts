"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { DASH_COOKIE, THEME_COOKIE, type DashLayout, type Theme } from "@/lib/prefs";

const YEAR = 60 * 60 * 24 * 365;

export async function setTheme(theme: Theme) {
  if (!["dark", "light", "auto"].includes(theme)) return;
  (await cookies()).set(THEME_COOKIE, theme, { maxAge: YEAR, path: "/", sameSite: "lax" });
  revalidatePath("/", "layout");
}

/** null puts the dashboard back to its default order */
export async function setDashLayout(layout: DashLayout | null) {
  const jar = await cookies();
  if (!layout) jar.delete(DASH_COOKIE);
  else {
    const clean = (a: string[]) => a.filter((x) => /^[a-z]{2,12}$/.test(x)).slice(0, 30);
    jar.set(DASH_COOKIE, JSON.stringify({ order: clean(layout.order), hidden: clean(layout.hidden) }), { maxAge: YEAR, path: "/", sameSite: "lax" });
  }
  revalidatePath("/");
}
