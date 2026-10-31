"use client";

import { useRef, type ReactNode } from "react";
import { btn } from "@/components/ui";
import { useConfirm } from "@/components/confirm";

/** Deleting a search removes everything collected for it: asked first */
export function ConfirmDelete({ action, children }: { action: () => Promise<void>; children: ReactNode }) {
  const confirm = useConfirm();
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={action}>
      <button type="button" className={`${btn.secondary} w-full text-red-700 dark:text-red-300`} data-testid="delete-search" onClick={async () => {
        if (await confirm({ title: "Supprimer cette recherche ?", message: "Toutes les annonces et ventes collectées pour elle seront effacées.", confirmLabel: "Supprimer", danger: true })) form.current?.requestSubmit();
      }}>{children}</button>
    </form>
  );
}
