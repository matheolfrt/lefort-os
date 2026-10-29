import { requireManager } from "@/lib/session";

/** Pages for managers only: Conseils, Objectifs, Statistiques, Scénarios (tabs of « Mon argent ») and Écoulement, Prix,
 * Niches (tabs of « Rotation »). Their tab bar comes from the app shell. */
export default async function ManagerPagesLayout({ children }: { children: React.ReactNode }) {
  await requireManager();
  return <div className="space-y-4">{children}</div>;
}
