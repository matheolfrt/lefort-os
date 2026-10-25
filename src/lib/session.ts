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

/** Loads the signed-in user's membership; redirects to login/onboarding when missing. */
export const getContext = cache(async (): Promise<AppContext> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("memberships")
    .select("role, organizations(*)")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!membership) redirect("/onboarding");

  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const role = membership.role as AppRole;
  return {
    userId: user.id,
    email: user.email ?? "",
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
