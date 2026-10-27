import { requireManager } from "@/lib/session";
import { PilotageTabs } from "./tabs";

/** Pilotage: one menu entry, five screens (Conseils, Écoulement, Niches, Statistiques, Scénarios) */
export default async function PilotageLayout({ children }: { children: React.ReactNode }) {
  await requireManager();
  return (
    <div className="space-y-4">
      <PilotageTabs />
      {children}
    </div>
  );
}
