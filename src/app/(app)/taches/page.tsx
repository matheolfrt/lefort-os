import { PageHeader } from "@/components/ui";
import { TodoList } from "@/components/todos/todo-list";
import { getContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { loadMembers } from "@/lib/members";
import { TODO_COLUMNS, parisToday, type Todo } from "@/lib/todos";

export const metadata = { title: "Tâches" };

export default async function Todos() {
  const ctx = await getContext();
  const supabase = await createClient();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [open, done, members] = await Promise.all([
    supabase.from("todos").select(TODO_COLUMNS).is("done_at", null).order("due_on", { nullsFirst: false }).limit(500),
    supabase.from("todos").select(TODO_COLUMNS).gte("done_at", since).order("done_at", { ascending: false }).limit(50),
    loadMembers(supabase),
  ]);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Tâches"
        subtitle="Ce qu'il y a à faire, pour vous ou l'équipe. Tapez « demain », « vendredi », « chaque lundi » ou « ! » à la fin d'une tâche." />
      <TodoList initial={(open.data ?? []) as Todo[]} done={(done.data ?? []) as Todo[]} members={members}
        me={ctx.userId} isManager={ctx.isManager} today={parisToday()} />
    </div>
  );
}
