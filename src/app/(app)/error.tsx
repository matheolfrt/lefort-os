"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { btn } from "@/components/ui";

/** Something failed while showing the page (connection lost, database update missing…): say it plainly, offer to retry */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  const offline = /fetch|network|load failed/i.test(error.message);
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-red-500/15 text-red-300"><AlertTriangle size={28} /></span>
      <h1 className="mt-4 text-2xl font-bold tracking-[-0.03em]">{offline ? "Connexion perdue" : "Cette page n'a pas pu s'afficher"}</h1>
      <p className="mt-2 text-muted">
        {offline
          ? "Vérifiez le réseau puis réessayez."
          : "Réessayez dans un instant. Si le problème continue, une mise à jour de la base est peut-être en attente (Paramètres → Mises à jour de la base)."}
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-muted/70">Code : {error.digest}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={reset} className={btn.primary}>Réessayer</button>
        <Link href="/" className={btn.secondary}>Tableau de bord</Link>
      </div>
    </div>
  );
}
