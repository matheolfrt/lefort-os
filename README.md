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
7. **Mises à jour de la base** : quand une nouvelle version a besoin d'une migration, un bandeau l'indique aux
   gérants ; Paramètres → Mises à jour de la base liste les fichiers manquants (bouton « Copier le SQL » + lien
   vers l'éditeur SQL). Optionnel : avec `SUPABASE_ACCESS_TOKEN` (jeton personnel Supabase → Account → Access
   Tokens) dans les variables Vercel, un bouton les applique en un clic via l'API Management de Supabase
   (`src/lib/migrations.ts` : chaque migration récente y est détectée par une fonction qu'elle crée).

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

## Production (Kanban)

`/postes/production` : la chaîne en 9 colonnes (Réception → Expédié), une colonne = un statut `items.status`
(un article en attente reste dans sa colonne, un retour revient en Réception). Glisser-déposer (souris, ou appui long
au doigt sur tablette) ou « Terminer » font avancer d'une étape par `kanban_move`, qui passe par la machine à états
et ses contrôles (photos, mesures, rangement, prix). Sauter une étape ou revenir en arrière : responsables seulement,
après confirmation, tracé comme correction (`forced`). Vendu et Expédié s'ouvrent sur Ventes et Expédition.
Priorité (`items.priority`), blocage avec raison (`blocked_reason`), employé assigné (`assigned_to`) ; chaque action
est dans `item_events` (qui, quand, de → vers). « Prochaine tâche » (`next_task`) choisit l'article en main, puis
assigné, puis le plus urgent et le plus ancien des étapes du rôle. Productivité et goulot : `production_stats`.
Colonnes virtualisées et chargées par pages de 30 (`production_board`, ~0,1 s sur 20 000 articles).
Migration `supabase/migrations/20261031000012_production_board.sql`, tests `supabase/tests/production_test.sql`.

## Conseils

`/conseils` (responsables) et carte « Conseils » du tableau de bord : tâches prioritaires et conseils de rentabilité
calculés par des règles explicites, sans IA. `advisor_facts()` rassemble les chiffres en un appel (files d'attente,
expéditions, réservations, stock dormant, prix à perte ou trop bas, marge et délai par marque, catégorie, taille,
tranche de prix et fournisseur, frais, tendance, CA à déclarer) ; `src/lib/advisor.ts` les transforme en conseils,
avec leurs seuils. Classement par marge par jour de stock. Migration `supabase/migrations/20261101000013_advisor.sql`
(qui accélère aussi les règles d'accès : rôle et organisation évalués une fois par requête).

## Niches

`/niches` (responsables) : niches à tester (idée → en test → validée ou abandonnée). Une niche = des critères (marques,
catégories, tailles, mots-clés du titre, gamme de prix) ; les lots achetés pour la tester s'y rattachent
(`batches.niche_id`, champ « Niche testée » à la création du lot). Résultats sur les vraies ventes (`v_niche_items`,
`niche_stats`) comparés à la moyenne : marge par article et par jour de stock, écoulement, retour sur l'argent investi,
prix d'achat maximum conseillé. Verdict après 5 ventes (réglable). Suggestions tirées des chiffres (marques, catégories,
tailles déjà rentables ou prometteuses) et idées de départ (`src/lib/niches.ts`).
Migration `supabase/migrations/20261102000014_niches.sql`.

## Écoulement

`/ecoulement` (responsables) : part des articles vendus dans les 30 jours après leur réception (objectif 80 %, réglable
dans Paramètres avec le délai). Le compteur de chaque article démarre à sa réception ; seuls les lots réellement achetés
comptent (stock existant et ventes importées exclus). Lots en cours : vendus, reste à vendre pour tenir l'objectif, rythme
requis et rythme actuel, articles pas encore en ligne, statut (en avance, dans les temps, à surveiller, en retard). Lots
terminés, puis détail par fournisseur, marque, catégorie et mois de réception. Les lots à risque et l'écoulement global
alimentent Conseils et le tableau de bord (`src/lib/sellthrough.ts`). Fonction `sellthrough_stats()`, migration
`supabase/migrations/20261103000015_sellthrough.sql`.

## Objectifs et tâches

- **Objectifs** (Pilotage → Objectifs) : chiffre d'affaires, articles vendus et articles mis en ligne, par jour, semaine,
  mois ou année. Une case vide est déduite des autres au même rythme (6 000 € par mois → 194 € par jour en octobre).
  Progression en direct (calendrier de Paris) sur le tableau de bord, avec le reste à faire par jour et la projection.
  L'équipe voit les objectifs en nombre d'articles, pas le chiffre d'affaires.
- **Tâches** (`/taches`) : liste partagée, avec date, personne, répétition (chaque jour / semaine / mois) et
  « important ». Saisie rapide : « Appeler Fripes & Co demain ! », « Faire la compta chaque lundi », ou
  « tâche … » dans ⌘K. Une tâche répétée cochée revient à sa prochaine date. Les conseils peuvent être ajoutés
  aux tâches du jour. Les tâches du jour sont sur le tableau de bord.
- Migration `supabase/migrations/20261104000016_goals_todos.sql`, tests `supabase/tests/goals_todos_test.sql`.

## Pilotage et confort d'utilisation

- **Pilotage** : une seule entrée de menu pour Conseils, Écoulement, Niches, Statistiques et Scénarios (onglets,
  groupe de routes `src/app/(app)/(pilotage)`, URLs inchangées, réservé aux gérants).
- **Stock modifiable sur place** : cliquer sur le prix, l'emplacement ou le statut d'une ligne pour le changer ;
  chaque changement (aussi les actions groupées) propose « Annuler » au lieu d'une confirmation
  (`src/lib/item-edits.ts`, partagé avec la fiche article et ⌘K). Les annulations passent par les mêmes règles
  de statut : un retour refusé est signalé, jamais forcé.
- **⌘K exécute des actions** (`src/lib/commands.ts`) : « M-12 29 », « baisser M-12 à 29,90 », « ranger M-12 en
  A-01-02 », « en ligne M-12 », « vendre M-12 », « étiquette M-12 ».
- **Raccourcis clavier** (`src/components/keyboard-shortcuts.tsx`) : `g` puis `d` `p` `t` `r` `o` `s` `l` `v` `e`,
  `n` nouvelle vente, `?` aide. Ignorés pendant la saisie et pendant un scan (touches trop rapprochées).
- **Fiche article** : photos en grand, carte « En bref » modifiable, historique unique (statuts + emplacements).
- **Aide** : écrans vides avec l'action suivante, bulles « ? » sur les chiffres clés.

## Scénarios

`/scenarios` (responsables) : simulateur de l'activité — stock, coût et prix moyens, écoulement mensuel, frais Vinted,
emballage et port, cotisations URSSAF, équipe, local, charges fixes, croissance du stock. Résultats : compte de résultat
mensuel, point mort, stock immobilisé, achats nécessaires, équipe nécessaire, projection et trésorerie sur 12 mois,
niveaux de stock, comparateur. « Mes chiffres réels » part des 90 derniers jours (`src/lib/scenario-baseline.ts`) ;
le moteur est `src/lib/scenario.ts`. Les scénarios sont enregistrés dans la table `scenarios` (lecture et écriture
réservées aux responsables).

## SKU par lot, mise en vente groupée, emplacements nommés

- `create_batch_skus` : à la création d'un lot (ou depuis sa page), préfixe + numéros consécutifs (M-1 … M-37),
  articles créés d'avance au statut « Reçu ». `receive_item` complète ensuite un article créé d'avance.
- `bulk_put_on_sale` : passe directement « En ligne » depuis toute étape avant la vente (prix facultatif).
- `save_location` / `archive_location` : emplacements de stockage nommés librement (le nom devient le code
  de l'étiquette, ex. EMP-PORTANT-HIVER), suppression d'un emplacement vide.

