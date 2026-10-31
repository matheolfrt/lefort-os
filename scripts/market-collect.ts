// « Niches Vinted » collector for GitHub Actions (or any computer): npx tsx scripts/market-collect.ts
// Needs LEFORT_SUPABASE_URL, LEFORT_SUPABASE_ANON_KEY and LEFORT_MARKET_KEY (a key made in Lefort OS → Niches Vinted).
import { collect, keyLink } from "../src/lib/market/collect";

const url = process.env.LEFORT_SUPABASE_URL, anon = process.env.LEFORT_SUPABASE_ANON_KEY, key = process.env.LEFORT_MARKET_KEY;
if (!url || !anon || !key) {
  console.log("Collecteur non configuré : ajoutez les secrets LEFORT_SUPABASE_URL, LEFORT_SUPABASE_ANON_KEY et LEFORT_MARKET_KEY.");
  process.exit(0);
}
const n = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
collect({
  link: keyLink(url, anon, key, process.env.MARKET_COLLECTOR ?? "github"),
  maxPages: n(process.env.MARKET_MAX_PAGES, 5),
  maxChecks: n(process.env.MARKET_MAX_CHECKS, 150),
  delayMs: n(process.env.MARKET_DELAY_MS, 1200),
  log: (l) => console.log(l),
})
  .then((s) => {
    console.log(`${s.searches.length} recherche(s), ${s.requests} requêtes à Vinted.`);
    // a refusal by Vinted is recorded in Lefort OS (status page); the job fails only when nothing worked at all
    if (s.searches.length && s.searches.every((x) => !x.ok)) process.exit(1);
  })
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
