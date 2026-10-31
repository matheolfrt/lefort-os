import { NextResponse } from "next/server";
import { collect, keyLink } from "@/lib/market/collect";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * « Niches Vinted » collector on the Vercel server, called by the Vercel schedule (vercel.json). Vercel signs the call
 * with CRON_SECRET; the collector key is MARKET_COLLECTOR_KEY. A small pass (one page, a few checks) to stay within
 * the time a free Vercel function may run.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET, key = process.env.MARKET_COLLECTOR_KEY;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false }, { status: 401 });
  if (!key) return NextResponse.json({ ok: false, probleme: "MARKET_COLLECTOR_KEY absente : créez une clé dans Niches Vinted → Collecteurs." }, { status: 503 });
  const summary = await collect({
    link: keyLink(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, key, "vercel"),
    maxPages: 1, maxChecks: 20, delayMs: 800, maxRequests: 40,
  });
  return NextResponse.json({ ok: summary.searches.some((s) => s.ok), ...summary });
}
