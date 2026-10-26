import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * Health check: is the app wired to a Supabase project whose schema is installed?
 * Public on purpose (no data returned, only yes/no answers) so a deploy can be verified before anyone logs in.
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, probleme: "Variables NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY absentes." }, { status: 500 });
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Anonymous callers are refused (42501) when the table/function exists; "not found" errors mean the migrations are missing
  const missing = (code?: string) => code === "PGRST205" || code === "PGRST202" || code === "42P01" || code === "42883";
  const [table, rpc, authHealth] = await Promise.all([
    supabase.from("items").select("id").limit(1),
    supabase.rpc("bootstrap_organization", { p_trade_name: "", p_full_name: "" }),
    fetch(`${url}/auth/v1/health`, { headers: { apikey: key } }).then((r) => r.ok).catch(() => false),
  ]);

  const schema = !missing(table.error?.code) && !missing(rpc.error?.code);
  return NextResponse.json(
    {
      ok: schema && authHealth,
      projet_supabase: new URL(url).hostname.split(".")[0],
      authentification: authHealth ? "ok" : "injoignable",
      migrations: schema ? "installées" : "absentes : exécutez supabase/migrations/*.sql dans ce projet",
      details: { items: table.error?.code ?? "ok", rpc: rpc.error?.code ?? "ok" },
    },
    { status: schema && authHealth ? 200 : 503 },
  );
}
