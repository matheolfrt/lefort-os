-- Lefort OS — objectives and to-dos ("Objectifs", "Tâches").
-- Objectives: a target per period (day, week, month, year) for sales revenue, items sold and items put on sale.
-- Progress is computed from the real data (Europe/Paris calendar). Revenue targets and figures are for managers only;
-- the team sees the item counts. To-dos: a simple shared list (title, due date, person, repeat).

create type goal_period as enum ('day', 'week', 'month', 'year');
create type goal_metric as enum ('revenue', 'sales', 'listed');

create table goals (
  org_id uuid not null references organizations(id),
  period goal_period not null,
  metric goal_metric not null,
  target bigint not null check (target > 0), -- cents for revenue, a number of items otherwise
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (org_id, period, metric)
);

alter table goals enable row level security;
grant select, insert, update, delete on goals to authenticated;
create policy goals_read on goals for select to authenticated
  using (org_id = (select public.auth_org_id()) and (metric <> 'revenue' or (select public.is_manager())));
create policy goals_mgr_insert on goals for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_manager()));
create policy goals_mgr_update on goals for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_manager()))
  with check (org_id = (select public.auth_org_id()));
create policy goals_mgr_delete on goals for delete to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_manager()));

/** Sets (or, with a null / zero target, removes) one objective */
create function public.set_goal(p_period goal_period, p_metric goal_metric, p_target bigint) returns void
language plpgsql security invoker set search_path = public as $$
declare v_org uuid := public.auth_org_id();
begin
  if v_org is null or not public.is_manager() then
    raise exception using errcode = 'LF403', message = 'Objectifs réservés aux responsables.';
  end if;
  if p_target is null or p_target <= 0 then
    delete from goals where org_id = v_org and period = p_period and metric = p_metric;
  else
    insert into goals(org_id, period, metric, target, updated_by) values (v_org, p_period, p_metric, p_target, auth.uid())
    on conflict (org_id, period, metric) do update set target = excluded.target, updated_at = now(), updated_by = auth.uid();
  end if;
end $$;
grant execute on function public.set_goal(goal_period, goal_metric, bigint) to authenticated;

/**
 * Where each period stands: current and previous period, plus the last 30 days day by day (for suggestions).
 * Revenue is null for people who are not managers.
 */
create function public.goal_progress() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.auth_org_id();
  v_mgr boolean := public.is_manager();
  v_now timestamptz := now();
  v_local timestamp := now() at time zone 'Europe/Paris';
  r jsonb;
begin
  if v_org is null then raise exception using errcode = 'LF403', message = 'Non connecté.'; end if;

  with bounds as (
    select p.period,
           (date_trunc(p.unit, v_local) at time zone 'Europe/Paris') as starts,
           ((date_trunc(p.unit, v_local) + p.len) at time zone 'Europe/Paris') as ends,
           ((date_trunc(p.unit, v_local) - p.len) at time zone 'Europe/Paris') as prev_starts
      from (values ('day', 'day', interval '1 day'), ('week', 'week', interval '1 week'),
                   ('month', 'month', interval '1 month'), ('year', 'year', interval '1 year')) as p(period, unit, len)
  ),
  sold as (
    select e.sold_at, e.revenue_cents
      from v_item_economics e
     where e.org_id = v_org and e.is_sold and e.sold_at >= (select min(prev_starts) from bounds)
  ),
  listed as (
    select i.listed_at from items i
     where i.org_id = v_org and i.deleted_at is null and i.listed_at >= (select min(prev_starts) from bounds)
  ),
  figures as (
    select b.period, b.starts, b.ends,
           (select count(*) from sold where sold_at >= b.starts and sold_at < b.ends) as sales,
           (select coalesce(sum(revenue_cents), 0) from sold where sold_at >= b.starts and sold_at < b.ends) as revenue,
           (select count(*) from listed where listed_at >= b.starts and listed_at < b.ends) as listed,
           (select count(*) from sold where sold_at >= b.prev_starts and sold_at < b.starts) as prev_sales,
           (select coalesce(sum(revenue_cents), 0) from sold where sold_at >= b.prev_starts and sold_at < b.starts) as prev_revenue,
           (select count(*) from listed where listed_at >= b.prev_starts and listed_at < b.starts) as prev_listed
      from bounds b
  ),
  days as (
    select d::date as day,
           (select count(*) from sold where (sold_at at time zone 'Europe/Paris')::date = d::date) as sales,
           (select coalesce(sum(revenue_cents), 0) from sold where (sold_at at time zone 'Europe/Paris')::date = d::date) as revenue,
           (select count(*) from listed where (listed_at at time zone 'Europe/Paris')::date = d::date) as listed
      from generate_series(v_local::date - 29, v_local::date, interval '1 day') d
  )
  select jsonb_build_object(
    'now', v_now,
    'manager', v_mgr,
    'periods', (select jsonb_object_agg(period, jsonb_build_object(
                  'starts', starts, 'ends', ends,
                  'sales', sales, 'listed', listed, 'revenue_cents', case when v_mgr then revenue end,
                  'prev', jsonb_build_object('sales', prev_sales, 'listed', prev_listed,
                                             'revenue_cents', case when v_mgr then prev_revenue end)))
                  from figures),
    'days', (select jsonb_agg(jsonb_build_object('day', day, 'sales', sales, 'listed', listed,
                  'revenue_cents', case when v_mgr then revenue end) order by day) from days),
    'goals', coalesce((select jsonb_agg(jsonb_build_object('period', period, 'metric', metric, 'target', target))
                  from goals where org_id = v_org and (metric <> 'revenue' or v_mgr)), '[]')
  ) into r;
  return r;
end $$;
revoke execute on function public.goal_progress() from public, anon;
grant execute on function public.goal_progress() to authenticated;

-- ── To-dos
create type todo_repeat as enum ('none', 'daily', 'weekly', 'monthly');

create table todos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.auth_org_id() references organizations(id),
  title text not null check (length(trim(title)) between 1 and 200),
  notes text check (notes is null or length(notes) <= 2000),
  due_on date,
  important boolean not null default false,
  assigned_to uuid references auth.users(id),
  repeat todo_repeat not null default 'none',
  repeated_from uuid references todos(id) on delete set null, -- the occurrence that, once done, created this one
  done_at timestamptz,
  done_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid(),
  updated_at timestamptz not null default now()
);
create index todos_open_idx on todos(org_id, due_on) where done_at is null;
create index todos_done_idx on todos(org_id, done_at desc) where done_at is not null;
create trigger todos_touch before update on todos for each row execute function private.touch_updated_at();

-- Everyone in the team sees the list and can add to it; people other than managers only give to-dos to themselves
-- (or to nobody) and only change those that are theirs or nobody's.
alter table todos enable row level security;
grant select, insert, update, delete on todos to authenticated;
create policy todos_read on todos for select to authenticated using (org_id = (select public.auth_org_id()));
create policy todos_insert on todos for insert to authenticated
  with check (org_id = (select public.auth_org_id())
              and ((select public.is_manager()) or assigned_to is null or assigned_to = (select auth.uid())));
create policy todos_update on todos for update to authenticated
  using (org_id = (select public.auth_org_id())
         and ((select public.is_manager()) or assigned_to is null or assigned_to = (select auth.uid()) or created_by = (select auth.uid())))
  with check (org_id = (select public.auth_org_id())
              and ((select public.is_manager()) or assigned_to is null or assigned_to = (select auth.uid())));
create policy todos_delete on todos for delete to authenticated
  using (org_id = (select public.auth_org_id()) and ((select public.is_manager()) or created_by = (select auth.uid())));

/** Ticks a to-do. A repeating one comes back: the next occurrence is created, one step later and after today. Returns its id. */
create function public.complete_todo(p_id uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  t todos;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_step interval;
  v_next date;
  v_new uuid;
begin
  update todos set done_at = now(), done_by = auth.uid() where id = p_id and done_at is null returning * into t;
  if t.id is null then
    if not exists (select 1 from todos where id = p_id) then
      raise exception using errcode = 'LF404', message = 'Tâche introuvable ou non modifiable.';
    end if;
    return null; -- already done
  end if;
  if t.repeat = 'none' then return null; end if;
  v_step := case t.repeat when 'daily' then interval '1 day' when 'weekly' then interval '1 week' else interval '1 month' end;
  -- one step after its date (done early, it still comes back next time), and after today if it was late;
  -- the rhythm is kept: a weekly Monday task stays on Mondays
  v_next := (coalesce(t.due_on, v_today) + v_step)::date;
  while v_next <= v_today loop v_next := (v_next + v_step)::date; end loop;
  insert into todos(org_id, title, notes, due_on, important, assigned_to, repeat, repeated_from, created_by)
  values (t.org_id, t.title, t.notes, v_next, t.important, t.assigned_to, t.repeat, t.id, t.created_by)
  returning id into v_new;
  return v_new;
end $$;
grant execute on function public.complete_todo(uuid) to authenticated;

/** Unticks a to-do; the next occurrence it created (if not started) goes away. Same rights as changing it. */
create function public.reopen_todo(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t todos;
begin
  select * into t from todos where id = p_id and org_id = public.auth_org_id();
  if t.id is null or not (public.is_manager() or t.assigned_to is null or t.assigned_to = auth.uid() or t.created_by = auth.uid()) then
    raise exception using errcode = 'LF404', message = 'Tâche introuvable ou non modifiable.';
  end if;
  update todos set done_at = null, done_by = null where id = p_id;
  delete from todos where repeated_from = p_id and done_at is null;
end $$;
grant execute on function public.reopen_todo(uuid) to authenticated;
