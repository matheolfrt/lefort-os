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

Le dossier `extension/` contient une extension Chrome (Manifest V3, sans étape de build).

**Synchronisation des ventes (automatique)** — toutes les heures (réglable), tant que Chrome est ouvert, l'extension
relit les ventes Vinted des 90 derniers jours depuis un onglet vinted.fr (ouvert en arrière-plan si besoin, puis
refermé) et les envoie à Lefort OS, qui décide (`supabase/migrations/20261108000020_vinted_reconcile.sql`) :

- chaque vente Vinted est gardée une seule fois (table `vinted_orders`, une ligne par numéro de transaction) et liée à
  une seule vente Lefort OS ; le numéro est aussi unique sur `orders` : **jamais de doublon**, même relue cent fois ;
- **vente sûre = enregistrée seule** : article reconnu par son annonce Vinted (lien fait à la publication, par l'import,
  ou par la « Réf. SKU » écrite dans la description) et en vente, vendue après la date de début choisie ;
- une **vente saisie à la main** est reconnue par son numéro ou par son article ; si elle ne fait que ressembler (même
  prix ou même acheteur, à 3 jours près), elle est **proposée**, jamais liée seule ;
- **tout ce qui est incertain attend une décision** sur la page **Ventes → Synchro Vinted** (`/ventes/vinted`) : article
  inconnu (choisir l'article, ou le créer), vente ressemblante, article déjà vendu ailleurs, annulée sur Vinted, supprimée
  dans Lefort OS, écart de prix, vente avant la date de début ;
- **rien n'est perdu** : chaque passage relit 90 jours ; le rapprochement montre ce qui est sur Vinted et pas dans Lefort
  OS, et l'inverse (après une lecture complète) ; une alerte apparaît sur le tableau de bord s'il y a des ventes à
  vérifier ou si la synchro n'a pas réussi depuis 2 jours ;
- **journal** de tout ce que fait la synchro, avec **Annuler** (une vente annulée n'est pas réenregistrée ; « Rétablir »
  la remet) ; une seule synchro à la fois (verrou dans l'extension et dans la base) ;
- l'extension relève aussi les **vues et favoris** de chaque annonce (`vinted_listings`, historique par jour dans
  `vinted_listing_stats`), affichés dans Finance → articles et utilisés dans les recommandations.

**Import du dressing (sur clic)** — importe les annonces inconnues de Lefort OS (statut « En ligne », SKU, photos,
emplacement `EMP-A-ETIQUETER`, lot « stock existant » hors registre des achats). Une annonce dont la description porte la
« Réf. » d'un article existant lui est reliée, jamais importée en double. Prix, réservations et annonces disparues se
resynchronisent sur clic.

Fonctions SQL : `vinted_sync_start`, `vinted_reconcile`, `vinted_listings_seen`, `vinted_sync_finish`, `vinted_known`,
`vinted_resolve`, `vinted_undo`, `vinted_link_item`, `vinted_reconciliation` (0020) ; `vinted_sync_preview`,
`vinted_apply_updates`, `vinted_import` (0004). Tests : `supabase/tests/vinted_sync_test.sql`, `vinted_test.sql`.
Code : `extension/sync.js` (la synchro), `background.js` (le planning), `vinted.js` (la lecture de Vinted).

Après toute modification : `npm run build:extension` régénère `public/lefort-os-vinted.zip`,
téléchargeable depuis Paramètres et depuis la page Synchro Vinted. Une nouvelle version de l'extension se recharge
dans `chrome://extensions` (« Mettre à jour » ou réinstaller le dossier).

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

## Fournisseurs

- **Classement** (`/fournisseurs`) : verdict par fournisseur (« À racheter », « Correct », « Rentable mais lent »,
  « À éviter », « Trop tôt pour juger ») avec sa raison. La marge est mesurée sur les articles vendus : le stock restant
  n'est pas compté comme une perte ; « Remboursé » dit quelle part de ce qui a été payé est revenue (ventes moins frais).
  Coût d'un article → prix de vente, écoulement à 30 jours, délai, articles écartés. Le stock d'avant Lefort OS est
  hors classement. Règles dans `src/lib/suppliers.ts` (mêmes seuils que les Conseils).
- **Fiche fournisseur** (`/fournisseurs/[id]`) : ce qui marche chez lui (marques, catégories, tailles), ses lots,
  achats et ventes sur 12 mois, coordonnées et notes modifiables, « Nouveau lot chez lui », archivage.
- Migration `supabase/migrations/20261105000017_suppliers.sql`, tests `supabase/tests/suppliers_test.sql`.

## Prix à baisser

- **Suggestions, jamais automatiques** (Pilotage → Prix, `/prix`) : selon le temps en ligne, par défaut −10 % après
  14 jours, −20 % après 30, −30 % après 45, calculés sur le prix de mise en ligne. Jamais sous le prix minimum de
  l'article ni sous coût + frais Vinted + envoi moyen + 1 € ; pas de nouvelle baisse moins de 7 jours après la
  précédente (une baisse annulée ne compte pas). Règles modifiables sur la page.
- « Appliquer » baisse le prix dans Lefort OS (avec « Annuler ») ; le prix Vinted se change à la main (lien vers
  l'annonce, liste « Baissés cette semaine »). « Pas maintenant » met une suggestion de côté 7 jours.
- Effet mesuré : part des articles vendus dans les 14 jours après une baisse, selon sa taille.
- Rappel sur le tableau de bord. Migration `supabase/migrations/20261106000018_price_suggestions.sql`,
  tests `supabase/tests/pricing_test.sql`.

## Pilotage et confort d'utilisation

- **Pilotage** : une seule entrée de menu pour Conseils, Écoulement, Niches, Statistiques et Scénarios (onglets,
  groupe de routes `src/app/(app)/(pilotage)`, URLs inchangées, réservé aux gérants).
- **Stock modifiable sur place** : cliquer sur le prix, l'emplacement ou le statut d'une ligne pour le changer ;
  chaque changement (aussi les actions groupées) propose « Annuler » au lieu d'une confirmation
  (`src/lib/item-edits.ts`, partagé avec la fiche article et ⌘K). Les annulations passent par les mêmes règles
  de statut : un retour refusé est signalé, jamais forcé.
- **⌘K exécute des actions** (`src/lib/commands.ts`) : « M-12 29 », « baisser M-12 à 29,90 », « ranger M-12 en
  A-01-02 », « en ligne M-12 », « vendre M-12 », « étiquette M-12 ».
- **Raccourcis clavier** (`src/components/keyboard-shortcuts.tsx`) : `g` puis `d` `p` `f` `t` `r` `o` `s` `l` `v` `e`,
  `n` nouvelle vente, `?` aide. Ignorés pendant la saisie et pendant un scan (touches trop rapprochées).
- **Fiche article** : photos en grand, carte « En bref » modifiable, historique unique (statuts + emplacements).
- **Aide** : écrans vides avec l'action suivante, bulles « ? » sur les chiffres clés.
- **Thème** : sombre par défaut, clair ou « Auto » (suit l'appareil), au bas du menu ; gardé sur l'appareil (cookie
  `lf_theme`, `src/lib/prefs.ts`).
- **Tableau de bord** : urgences toujours en haut (expéditions et travail en retard, prix à baisser), puis objectifs,
  argent et le reste ; « Personnaliser » masque et réordonne les cartes (cookie `lf_dash`, `src/lib/dashboard-layout.ts`).
- **Ma journée** : tout en haut, une phrase écrite à partir des chiffres : hier (ventes, CA) contre votre journée
  habituelle (les jours depuis la première vente, jamais des zéros d'avant l'ouverture), puis aujourd'hui : commandes à
  expédier, articles prêts à publier, prix à baisser, et ce qu'il faut par jour pour tenir l'objectif du mois. Pour
  l'équipe, la même phrase sans argent (`src/lib/day-brief.ts`).
- **Comparaisons** (« Ce mois-ci ») : CA encaissé, bénéfice, ventes, panier moyen comparés aux **mêmes jours** du mois
  dernier (du 1er au 29 contre du 1er au 29) et à la moyenne des 3 mois d'avant ; le délai de vente (90 jours glissants)
  à lui-même un mois plus tôt. Flèche **et** mot « au-dessus / en dessous / au même niveau » (jamais la couleur seule),
  vert ou rouge selon que c'est une bonne nouvelle (un délai plus court est en vert), gris sous 10 observations
  (« peu de données »). Une courbe des 30 derniers jours dans chaque tuile (`src/lib/compare.ts`, `npm run test:compare`).

## Scénarios

`/scenarios` (responsables) : simulateur de l'activité — stock, coût et prix moyens, écoulement mensuel, frais Vinted,
emballage et port, cotisations URSSAF, équipe, local, charges fixes, croissance du stock. Résultats : compte de résultat
mensuel, point mort, stock immobilisé, achats nécessaires, équipe nécessaire, projection et trésorerie sur 12 mois,
niveaux de stock, comparateur. « Mes chiffres réels » part des 90 derniers jours (`src/lib/scenario-baseline.ts`) ;
le moteur est `src/lib/scenario.ts`. Les scénarios sont enregistrés dans la table `scenarios` (lecture et écriture
réservées aux responsables). Trois scénarios types partent des chiffres réels : Conservateur (ventes −25 %, prix
−5 %, coût +5 %), Base, Agressif (ventes +20 %, stock +5 %/mois) ; chacun affiche le cash nécessaire (stock + un mois de
charges + creux de trésorerie sur 12 mois) et le retour sur capital.

## Rotation des lots

Fiche d'un lot → **Performance du lot** (`src/components/lots/lot-performance.tsx`, calculs `src/lib/lot-rotation.ts`,
vue `v_lot_rotation` de `supabase/migrations/20261109000021_lot_rotation.sql`) :

- **🚀 Premier article mis en ligne** : un clic enregistre `batches.listing_started_at` (date et heure). Cliquable une seule
  fois ; jamais déplacé quand d'autres articles passent en ligne ; un responsable peut le corriger (« Modifier la date de
  début », avec confirmation, tracé). Lot déjà en ligne sans date : alerte et date à choisir — jamais inventée (la
  première publication connue est seulement proposée).
- Trois indicateurs distincts, côte à côte :
  - **Mise en ligne** = dernier article mis en ligne − premier (en cours : rythme articles/jour et fin estimée) ;
  - **Vente moyenne** = moyenne de (vente − mise en ligne) de chaque article vendu, depuis **sa propre** date de mise en
    ligne (`items.listed_at`, posée une seule fois) ;
  - **Liquidation** = dernière vente − **premier** article mis en ligne, figée quand le lot est liquidé ; avant, une
    projection d'après le rythme de ventes du lot (5 ventes et 7 jours minimum), toujours affichée comme estimation.
- Statuts calculés : Stock reçu, Mise en ligne, 100 % en ligne, Liquidation, Liquidé (articles écartés non attendus ;
  ventes annulées, supprimées ou retournées non comptées). Chronologie avec les dates réelles ; statut et vente moyenne
  dans la liste des lots.
- Tests : `npm run test:lots` et `supabase/tests/lot_rotation_test.sql` (300 blazers : 29 j de mise en ligne, 20 j de
  vente moyenne, 59 j de liquidation depuis le premier listing).

## Où est mon argent ? (Financial Command Center)

`/finance` (responsables, menu « Finance », raccourci `g f`, carte sur le tableau de bord). Huit sections : capital
(cash, stock, stock dormant, à recevoir), stock et capital immobilisé (coût, prix affiché, liquidation, âge, dormant),
performance, rotation et rendement du capital, trésorerie et prévision 7/30/60/90 j, budget d'achat, recommandations,
analyse par catégorie / marque / fournisseur / taille / matière / plateforme. Chaque chiffre a son « Comment est calculé
ce chiffre ? » et mène aux articles ou ventes qui le composent (`/finance/articles`, `/finance/ventes`,
`/finance/a-recevoir`).

- **Trésorerie** : dernier solde déclaré + encaissements Vinted − remboursements − frais d'envoi − lots achetés −
  charges depuis ce solde. Jamais devinée : sans solde, elle est « non déclarée ».
- **Charges** : récurrentes (comptées à chaque échéance) et ponctuelles ; une catégorie qui a une charge récurrente ne
  compte pas ses dépenses ponctuelles en plus (pas de double comptage).
- **Prévision** : rythme réel des N derniers jours, limité par le stock, délai de paiement Vinted, charges, achats
  prévus, cotisations à leur échéance ; fourchette ±25 % ; saisonnalité seulement avec plus d'un an d'historique.
- **Budget d'achat** : le plus petit de (trésorerie + à recevoir − dépenses 30 j − achats engagés − réserve), du plus
  bas niveau de trésorerie prévu au-dessus de la réserve et du stock nécessaire. La réserve n'est jamais dépensable.
- **Paramètres** (`/finance/parametres`) : solde, réserve, seuils d'immobilisation, âge du stock et stock dormant,
  facteur de liquidation, hypothèses de prévision, charges récurrentes, dépenses, achats prévus. Rien n'est figé dans le
  code.
- Calculs : `src/lib/finance/calc.ts` et `insights.ts` (fonctions pures), agrégats SQL dans
  `supabase/migrations/20261107000019_finance.sql` (`finance_overview`, `finance_items`, `finance_sales`,
  `finance_receivables`, `finance_segments`, `price_plan`, `finance_snapshot`). Tests : `npm run test:finance`
  et `supabase/tests/finance_test.sql`.

## SKU par lot, mise en vente groupée, emplacements nommés

- `create_batch_skus` : à la création d'un lot (ou depuis sa page), préfixe + numéros consécutifs (M-1 … M-37),
  articles créés d'avance au statut « Reçu ». `receive_item` complète ensuite un article créé d'avance.
- `bulk_put_on_sale` : passe directement « En ligne » depuis toute étape avant la vente (prix facultatif).
- `save_location` / `archive_location` : emplacements de stockage nommés librement (le nom devient le code
  de l'étiquette, ex. EMP-PORTANT-HIVER), suppression d'un emplacement vide.

