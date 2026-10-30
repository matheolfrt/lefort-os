import { getContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, PageHeader } from "@/components/ui";
import { readPlan } from "@/lib/warehouse";
import { Planner } from "./planner";

export const metadata = { title: "Mon futur local" };

/** « Mon futur local » : a room of 200 m² in 3D, and the shelves placed in it */
export default async function Local() {
  const ctx = await getContext();
  const supabase = await createClient();
  const { data, error } = await supabase.from("floor_plans").select("id, plan").eq("name", "Mon futur local").maybeSingle();
  if (error) {
    return (
      <>
        <PageHeader title="Mon futur local" />
        <Empty action={ctx.isManager ? { href: "/parametres/mises-a-jour", label: "Mettre à jour la base" } : undefined}>
          Le plan du local a besoin d&apos;une mise à jour de la base de données{ctx.isManager ? "." : " : demandez-la à un responsable."}
        </Empty>
      </>
    );
  }
  return <Planner initial={readPlan(data?.plan)} canEdit={ctx.isManager} planId={(data?.id as string | undefined) ?? null} />;
}
