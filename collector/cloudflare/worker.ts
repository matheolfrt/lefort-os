// « Niches Vinted » collector as a Cloudflare Worker (free plan): a third, independent source of passes.
// Each trigger handles one search (the one waited for the longest), within the 50 requests a free Worker may make.
// Deploy: see collector/cloudflare/README.md
import { collect, keyLink } from "../../src/lib/market/collect";

interface Env { LEFORT_SUPABASE_URL: string; LEFORT_SUPABASE_ANON_KEY: string; LEFORT_MARKET_KEY: string }

const worker = {
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(collect({
      link: keyLink(env.LEFORT_SUPABASE_URL, env.LEFORT_SUPABASE_ANON_KEY, env.LEFORT_MARKET_KEY, "cloudflare"),
      maxSearches: 1, maxPages: 2, maxChecks: 25, maxRequests: 40, delayMs: 700,
    }));
  },
};

export default worker;
