import { getContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, PageHeader } from "@/components/ui";
import { NotesApp, type Note } from "./notes-app";

export const metadata = { title: "Notes" };

/** A notepad: private notes, or shared with the team; saved as one types */
export default async function Notes({ searchParams }: { searchParams: Promise<{ note?: string }> }) {
  const ctx = await getContext();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data, error }, { data: people }] = await Promise.all([
    supabase.from("notes").select("id, title, body, pinned, shared, author_id, updated_at")
      .order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(1000),
    supabase.from("profiles").select("id, full_name"),
  ]);
  if (error) {
    return (
      <>
        <PageHeader title="Notes" />
        <Empty action={ctx.isManager ? { href: "/parametres/mises-a-jour", label: "Mettre à jour la base" } : undefined}>
          Les notes ont besoin d&apos;une mise à jour de la base de données{ctx.isManager ? "." : " : demandez-la à un responsable."}
        </Empty>
      </>
    );
  }
  const names = Object.fromEntries((people ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? "Quelqu'un"]));
  return <NotesApp initial={(data ?? []) as Note[]} me={ctx.userId} names={names} open={sp.note ?? null} />;
}
