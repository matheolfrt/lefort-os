import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, Organization } from "@/lib/types";

export interface AppContext {
  userId: string;
  email: string;
  fullName: string;
  role: AppRole;
  org: Organization;
  isManager: boolean;
}

/** Payload of a JWT (not verified here: see getContext) */
function tokenClaims(token: string): { sub?: string; email?: string } | null {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** Loads the signed-in user's membership; redirects to login/onboarding when missing. */
export const getContext = cache(async (): Promise<AppContext> => {
  const supabase = await createClient();
  // The middleware has already verified this request's token (getClaims). Here the session is read from the cookie
  // without another network round trip: it only decides which page to show, and every query below is checked by the
  // database itself, which rejects a token that is not genuine.
  const { data: { session } } = await supabase.auth.getSession();
  const claims = session ? tokenClaims(session.access_token) : null;
  const userId = claims?.sub;
  if (!userId) redirect("/login");

  // membership and profile in parallel: one round trip instead of two
  const [{ data: membership }, { data: profile }] = await Promise.all([
    supabase.from("memberships").select("role, organizations(*)").eq("user_id", userId).eq("active", true).maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);
  if (!membership) redirect("/onboarding");

  const role = membership.role as AppRole;
  return {
    userId,
    email: claims?.email ?? "",
    fullName: profile?.full_name ?? "",
    role,
    org: membership.organizations as unknown as Organization,
    isManager: role === "admin" || role === "manager",
  };
});

export async function requireManager() {
  const ctx = await getContext();
  if (!ctx.isManager) redirect("/");
  return ctx;
}
