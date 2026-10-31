import { Plus, Search, Trash2 } from "lucide-react";
import { Card, Empty, Field, Help, Kbd, PageHeader, Stat, StatusChip, btn, chip, input, seg } from "@/components/ui";
import { STATUS_DOT } from "@/i18n/fr";
import type { ItemStatus } from "@/lib/types";

export const metadata = { title: "Guide de style" };

/** The building blocks of every page, in one place: what to reuse before writing a new button or a new colour */
const FAMILIES: { name: string; use: string; statuses: ItemStatus[] }[] = [
  { name: "Violet · en atelier", use: "pas encore en vente : reçu, trié, photographié, mesuré", statuses: ["received", "sorted", "photographed", "measured"] },
  { name: "Vert · disponible", use: "prêt à publier ou en ligne", statuses: ["listing_ready", "listed"] },
  { name: "Jaune · réservé", use: "réservé par un acheteur", statuses: ["reserved"] },
  { name: "Bleu · vendu", use: "vendu, puis expédié", statuses: ["sold", "shipped"] },
  { name: "Gris · terminé", use: "vente close", statuses: ["completed"] },
  { name: "Rouge · action requise", use: "en attente, écarté, retourné", statuses: ["on_hold", "rejected", "returned"] },
];

export default function Design() {
  return (
    <div className="space-y-6" data-testid="design">
      <PageHeader title="Guide de style" subtitle="Les éléments communs à toutes les pages : à réutiliser tels quels."
        actions={<><button className={btn.secondary}>Action secondaire</button><button className={btn.primary}><Plus size={18} /> Action principale</button></>} />

      <Card title="En-tête de page">
        <p className="text-sm text-muted">Titre à gauche, une seule action principale (verte) à droite, en dernier ; les autres actions en secondaire
          avant elle. Sur téléphone, l&apos;action principale passe en premier, sur toute la largeur. Les filtres viennent sous l&apos;en-tête.</p>
      </Card>

      <Card title="Boutons">
        <p className="mb-3 text-sm text-muted">Le vert est réservé aux actions : un bouton vert fait quelque chose. Un onglet choisi, un élément de menu actif ou un état n&apos;est jamais vert plein.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button className={btn.primary}>Principal</button>
          <button className={btn.secondary}>Secondaire</button>
          <button className={btn.danger}><Trash2 size={16} /> Supprimer</button>
          <button className={btn.sm}>Petit principal</button>
          <button className={btn.ghost}>Contour</button>
          <button className={btn.icon} aria-label="Rechercher"><Search size={16} /></button>
          <button className={btn.primary} disabled>Désactivé</button>
        </div>
        <div className="mt-3 max-w-md"><button className={btn.huge}>Très grand (postes, téléphone)</button></div>
      </Card>

      <Card title="Onglets et choix">
        <div className="flex flex-wrap gap-3">
          <div role="tablist" aria-label="Exemple" className={seg.wrap}>
            {["Stock", "Performance", "Picking"].map((l, i) => <button key={l} role="tab" aria-selected={i === 0} className={seg.item(i === 0)}>{l}</button>)}
          </div>
          <div role="radiogroup" aria-label="Période" className={seg.wrap}>
            {["Ce mois", "Cette semaine"].map((l, i) => <button key={l} role="radio" aria-checked={i === 1} className={seg.item(i === 1)}>{l}</button>)}
          </div>
        </div>
      </Card>

      <Card title="Couleurs des statuts">
        <p className="mb-3 text-sm text-muted">Une famille de couleur par type d&apos;état, la même dans le stock, les postes, les ventes et l&apos;entrepôt 3D.
          Le mot dit toujours l&apos;étape exacte : la couleur ne suffit jamais seule.</p>
        <ul className="space-y-3">
          {FAMILIES.map((f) => (
            <li key={f.name} className="flex flex-wrap items-center gap-2">
              <span className="w-48 text-sm font-semibold">{f.name}</span>
              {f.statuses.map((s) => <span key={s} className="inline-flex items-center gap-1.5"><span className={`size-2.5 rounded-full ${STATUS_DOT[s]}`} aria-hidden /><StatusChip status={s} /></span>)}
              <span className="text-xs text-muted">{f.use}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className={`${chip} bg-sky-400/10 text-sky-200 ring-sky-400/25`}>Pastille d&apos;information</span>
          <span className={`${chip} bg-emerald-400/10 text-emerald-200 ring-emerald-400/25`}>Bon</span>
          <span className={`${chip} bg-red-400/10 text-red-200 ring-red-400/25`}>À surveiller</span>
        </div>
      </Card>

      <Card title="Chiffres et codes">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Chiffre d'affaires" value="12 480 €" hint="police du texte, chiffres alignés" help="Un montant ou un compteur : classe figure." />
          <Stat label="Articles en ligne" value="1 204" hint="même règle pour les compteurs" />
          <div className="rounded-2xl border border-line bg-panel/80 px-4 py-3">
            <div className="eyebrow-tight text-muted">Codes (lus caractère par caractère)</div>
            <div className="mt-1.5 font-mono text-lg font-semibold">LSH00019 · A-03-L4</div>
            <div className="text-xs text-muted">police à chasse fixe : SKU, lots, emplacements</div>
          </div>
        </div>
      </Card>

      <Card title="Formulaires">
        <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
          <Field label="Nom du fournisseur" hint="Une aide courte sous le champ."><input className={input} placeholder="Ex. Fripes Grossiste Lille" /></Field>
          <Field label="SKU"><input className={`${input} font-mono uppercase`} placeholder="Scannez ou tapez un SKU" /></Field>
        </div>
        <p className="mt-3 text-sm text-muted">Raccourcis : <Kbd>⌘</Kbd> <Kbd>K</Kbd> pour chercher partout. Une explication : <Help text="Le « ? » explique un chiffre, au survol, au clavier et au toucher." /></p>
      </Card>

      <Empty action={{ href: "/stock", label: "Voir le stock" }}>Un écran vide dit quoi faire ensuite, avec le bouton qui le fait.</Empty>
    </div>
  );
}
