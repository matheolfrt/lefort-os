import Link from "next/link";
import { btn } from "@/components/ui";

/** An address that is not a page of Lefort OS */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-accent font-mono text-xl font-bold text-accent-fg">L</span>
        <h1 className="mt-4 text-2xl font-bold tracking-[-0.03em]">Page introuvable</h1>
        <p className="mt-2 text-muted">Cette adresse ne correspond à aucune page de Lefort OS.</p>
        <Link href="/" className={`${btn.primary} mt-6`}>Retour au tableau de bord</Link>
      </div>
    </div>
  );
}
