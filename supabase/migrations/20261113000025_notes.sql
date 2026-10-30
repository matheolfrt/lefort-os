-- Lefort OS — notes: a notepad in the app. A note is private to the person who wrote it, unless they share it with the
-- team (then everyone in the shop reads it; only its author changes or deletes it). Saved as one types.

create table notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.auth_org_id() references organizations(id),
  author_id uuid not null default auth.uid() references auth.users(id),
  title text not null default '' check (length(title) <= 200),
  body text not null default '' check (length(body) <= 100000),
  pinned boolean not null default false,
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_org_idx on notes(org_id, updated_at desc);
create trigger notes_touch before update on notes for each row execute function private.touch_updated_at();

alter table notes enable row level security;
grant select, insert, delete on notes to authenticated;
-- only the content changes: the author, the shop and the creation date never do
grant update (title, body, pinned, shared) on notes to authenticated;
-- mine, and those shared in my shop
create policy notes_read on notes for select to authenticated
  using (org_id = (select public.auth_org_id()) and (author_id = (select auth.uid()) or shared));
create policy notes_insert on notes for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and author_id = (select auth.uid()));
create policy notes_update on notes for update to authenticated
  using (org_id = (select public.auth_org_id()) and author_id = (select auth.uid()))
  with check (org_id = (select public.auth_org_id()) and author_id = (select auth.uid()));
create policy notes_delete on notes for delete to authenticated
  using (org_id = (select public.auth_org_id()) and author_id = (select auth.uid()));

-- detects that this update is installed
create function public.notes_ready() returns boolean language sql stable as $$ select true $$;
revoke all on function public.notes_ready() from public, anon;
grant execute on function public.notes_ready() to authenticated;
