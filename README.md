# Lefort OS

Système d'exploitation interne de **Lefort Second Hand** : réception des lots, tri, photos, mesures,
rangement, publication Vinted, ventes, expédition, rentabilité et compta micro-entreprise.

Stack : Next.js 15 (App Router, TypeScript, Tailwind) · Supabase (Postgres, Auth, Storage, RLS).

## Architecture en bref

- **La base de données est le cœur métier.** Toute transition d'état passe par des fonctions SQL
  (`supabase/migrations/*_domain.sql`) qui vérifient rôle, règles de passage et contrôles
  (photos requises, mesures, emplacement de stockage…). L'interface ne peut pas contourner ces règles.
- **Cycle de vie d'un article** : Reçu → Trié → Photographié → Mesuré → Prêt à publier → En ligne
  → (Réservé) → Vendu → Expédié → Terminé, plus En attente / Écarté / Retourné.
  L'emplacement physique est suivi en permanence (zones de travail + bacs de stockage).
- **Historique financier figé** : prix de vente et coût de revient sont copiés dans la ligne de vente ;
  remboursements et ajustements de coût sont des écritures nouvelles, jamais des modifications.
- **Permissions** : RLS par organisation ; coûts, marges et commandes visibles uniquement par
  administrateur / responsable.

## Mise en service

1. **Créer un projet Supabase** sur https://supabase.com (région Europe, ex. Paris `eu-west-3`).
2. **Appliquer les migrations** : SQL Editor → coller puis exécuter, dans l'ordre, les fichiers de
   `supabase/migrations/`. (Ou avec la CLI : `npx supabase link` puis `npx supabase db push`.)
3. **Variables d'environnement** : copier `.env.example` en `.env.local` et renseigner l'URL et la clé
   `anon` (Supabase → Project Settings → API).
4. **Lancer** : `npm install` puis `npm run dev` → http://localhost:3000.
5. **Premier compte** : créez votre compte sur la page de connexion ; l'écran « Bienvenue » crée
   l'espace Lefort Second Hand avec catégories, gabarits de mesures, emplacements et taux URSSAF.
6. **Déploiement** : importer le dépôt sur Vercel, ajouter les deux variables d'environnement.
   Sur iPhone : ouvrir l'URL dans Safari → Partager → « Sur l'écran d'accueil ».

## Étiquettes (MUNBYN P130B)

- Étiquettes article : rouleau 57 × 32 mm ou 50 × 30 mm (format 4 × 6 possible : 4 par feuille).
- Étiquettes d'emplacement : 4 × 6.
- iPhone : ouvrir le PDF → Partager → app MUNBYN. Ordinateur (USB) : imprimer à 100 %.

## Tests

```bash
# Postgres 16 local requis (PGHOST/PGPORT/PGUSER)
npm run test:db
```

`supabase/tests/domain_test.sql` rejoue le cycle complet (réception → vente → retour → compta) et
vérifie permissions, répartition des coûts au centime, protection de l'historique et calcul URSSAF.

## À vérifier régulièrement

Taux URSSAF et seuils (franchise de TVA, plafond micro) évoluent : Paramètres → Taux URSSAF, et
`src/lib/compliance.ts` pour les seuils.
