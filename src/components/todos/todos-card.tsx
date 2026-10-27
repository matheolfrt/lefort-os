import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { loadMembers } from "@/lib/members";
import { TODO_COLUMNS, parisToday, type Todo } from "@/lib/todos";
import { TodoList } from "./todo-list";

/** The day's to-dos on the dashboard: late and today, mine or the team's; adding one is one line */
export async function TodosCard({ me, isManager }: { me: string; isManager: boolean }) {
  const supabase = await createClient();
  const [{ data }, members] = await Promise.all([
    supabase.from("todos").select(TODO_COLUMNS).is("done_at", null).order("due_on", { nullsFirst: false }).limit(300),
    loadMembers(supabase),
  ]);
  return (
    <section data-testid="dashboard-todos">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="eyebrow text-muted">Mes tâches du jour</h2>
        <Link href="/taches" className="-my-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-series-1 hover:underline">
          Toutes les tâches <ChevronRight size={16} />
        </Link>
      </div>
      <TodoList variant="dashboard" initial={(data ?? []) as Todo[]} members={members} me={me} isManager={isManager} today={parisToday()} />
    </section>
  );
}
