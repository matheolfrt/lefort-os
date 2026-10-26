import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Public connection settings for the Chrome extension: the Supabase project URL and its anon key.
 * Both are already shipped to every browser that opens the app; signing in still requires an account.
 */
export function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  return NextResponse.json({ app: "lefort-os", supabaseUrl, anonKey }, { headers: { "Access-Control-Allow-Origin": "*" } });
}
