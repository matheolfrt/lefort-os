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
   `supabase/migrations/`. (Ou avec la CLI : `npx supabase@latest link` puis `npx supabase@latest db push`.)
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

## Extension Chrome Vinted

Le dossier `extension/` contient une extension Chrome (Manifest V3, sans étape de build) qui :

- lit le dressing Vinted de l'utilisateur connecté, depuis l'onglet vinted.fr ouvert, uniquement sur clic ;
- importe les annonces inconnues de Lefort OS (statut « En ligne », SKU, photos, emplacement `EMP-A-ETIQUETER`,
  lot « stock existant » exclu du registre des achats) ;
- resynchronise : prix et réservations modifiés sur Vinted, ventes faites sur Vinted à saisir,
  annonces disparues de Vinted ;
- lit les **commandes Vinted** (ventes) : prix réel après offre, acheteur, dates, état. Les ventes inconnues sont
  enregistrées (`import_sales`, référence = numéro de transaction Vinted ; articles inconnus créés), les commandes
  déjà saisies sont reconnues par leur numéro ou leurs articles et avancées à l'état Vinted (`vinted_orders_preview`,
  `vinted_orders_sync`, `supabase/migrations/20261028000009_vinted_orders.sql`). Une date de coupure choisit les
  ventes historiques (déjà déclarées). Les commandes terminées ne sont plus rouvertes aux lectures suivantes.

Les annonces sont identifiées par leur numéro Vinted : relancer un import ne crée jamais de doublon.
Fonctions SQL : `vinted_sync_preview`, `vinted_apply_updates`, `vinted_import`
(`supabase/migrations/20261026000004_vinted_sync.sql`, testées dans `supabase/tests/vinted_test.sql`).

Après toute modification : `npm run build:extension` régénère `public/lefort-os-vinted.zip`,
téléchargeable depuis Paramètres.

## Import / export CSV et suppression

- **Exports** (format Excel français : `;`, virgule décimale, UTF-8) : `Stock → Exporter CSV` exporte la liste
  affichée (filtres compris, coûts pour les responsables) ; `Ventes → Exporter CSV` donne une ligne par article vendu.
- **Import de l'inventaire** (`/stock/import`) : crée les nouveaux SKU dans un lot et, si demandé, met à jour les SKU
  existants champ par champ. Un export peut être modifié puis réimporté (articles vendus et statuts ignorés).
  Fonction SQL `import_items`.
- **Import des ventes** (`/ventes/import`) : une ligne par article vendu ; même « Réf commande » = vente groupée.
  Chaque vente passe par `record_sale` (via `import_sales`). Un SKU absent du stock (ou une ligne sans SKU, reconnue
  par son lien Vinted si elle existe) crée l'article dans un lot « LOT-HISTORIQUE ». Ventes **historiques** (déjà déclarées) :
  `orders.is_historical`, comptées dans les statistiques mais exclues du livre des recettes et du CA URSSAF.
- **Suppression** : `delete_items` / `restore_items` (corbeille, responsables uniquement). Un article vendu n'est
  supprimé qu'avec `p_with_sales` : sa vente est annulée (`void_order`), jamais effacée. `void_order` annule aussi une
  vente seule (erreur, doublon d'import) : elle sort des totaux et du livre des recettes, ses articles reviennent
  « prêt à publier » et la référence Vinted est libérée (`supabase/migrations/20261029000010_void_sales.sql`).
