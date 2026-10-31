# Collecteur Cloudflare (gratuit)

Un troisième collecteur, indépendant de GitHub et de Vercel. Il traite une recherche toutes les 20 minutes.

1. Créez un compte gratuit sur cloudflare.com.
2. Dans ce dossier : `npx wrangler login`, puis `npx wrangler deploy`.
3. Ajoutez les trois secrets :
   `npx wrangler secret put LEFORT_SUPABASE_URL`, `npx wrangler secret put LEFORT_SUPABASE_ANON_KEY`,
   `npx wrangler secret put LEFORT_MARKET_KEY` (une clé créée dans Lefort OS → Niches Vinted → Collecteurs).

Ses passages apparaissent dans Lefort OS → Niches Vinted → Collecteurs, avec la réponse de Vinted.
