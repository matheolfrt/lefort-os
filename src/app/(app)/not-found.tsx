import Link from "next/link";
import { SearchX } from "lucide-react";
import { btn } from "@/components/ui";

/** An article, lot, niche or location that does not exist (wrong SKU, deleted, link from elsewhere) */
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-panel-2 text-muted"><SearchX size={28} /></span>
      <h1 className="mt-4 text-2xl font-bold tracking-[-0.03em]">Introuvable</h1>
      <p className="mt-2 text-muted">
        Cet élément n&apos;existe pas ou a été supprimé. Vérifiez le SKU ou le code, ou cherchez-le avec la recherche (⌘K).
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href="/stock" className={btn.primary}>Aller au stock</Link>
        <Link href="/" className={btn.secondary}>Tableau de bord</Link>
      </div>
    </div>
  );
}
