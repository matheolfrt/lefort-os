-- Lefort OS — « Mon futur local » : the plan of a room and the shelves placed in it, drawn in 3D. Saved per shop so it
-- is found again on any device; the whole team can look at it, managers change it.

create table floor_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.auth_org_id() references organizations(id),
  name text not null default 'Mon futur local' check (length(trim(name)) between 1 and 100),
  plan jsonb not null default '{}'::jsonb check (pg_column_size(plan) <= 1000000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) default auth.uid()
);
create unique index floor_plans_name_uq on floor_plans(org_id, lower(name));
create trigger floor_plans_touch before update on floor_plans for each row execute function private.touch_updated_at();

alter table floor_plans enable row level security;
grant select, insert, delete on floor_plans to authenticated;
grant update (name, plan, updated_by) on floor_plans to authenticated;
create policy floor_plans_read on floor_plans for select to authenticated using (org_id = (select public.auth_org_id()));
create policy floor_plans_insert on floor_plans for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_manager()));
create policy floor_plans_update on floor_plans for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_manager()))
  with check (org_id = (select public.auth_org_id()));
create policy floor_plans_delete on floor_plans for delete to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_manager()));

create function public.floor_plans_ready() returns boolean language sql stable as $$ select true $$;
revoke all on function public.floor_plans_ready() from public, anon;
grant execute on function public.floor_plans_ready() to authenticated;
