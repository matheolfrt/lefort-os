-- Lefort OS — mesures par SKU importées d'un fichier. Each SKU's measurements are kept: an article already prepared
-- gets them at once, an article created later with that SKU gets them at its creation.

create table sku_measures (
  org_id uuid not null default public.auth_org_id() references organizations(id),
  sku text not null check (sku ~ '^\S{1,64}$'),
  measures text not null check (length(measures) between 1 and 5000),
  file_name text check (length(file_name) <= 300),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id),
  primary key (org_id, sku)
);
create unique index sku_measures_upper_idx on sku_measures(org_id, upper(sku));

alter table sku_measures enable row level security;
grant select, delete on sku_measures to authenticated;
create policy sku_measures_read on sku_measures for select to authenticated using (org_id = (select public.auth_org_id()));
create policy sku_measures_delete on sku_measures for delete to authenticated using (org_id = (select public.auth_org_id()));

-- an article created (or renamed) without measurements takes those imported for its SKU
create function private.listing_draft_measures() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.measures, '') = '' then
    new.measures := coalesce((select measures from sku_measures where org_id = new.org_id and upper(sku) = upper(new.sku)), '');
  end if;
  return new;
end $$;
-- after listing_drafts_item (alphabetical order of triggers): the SKU has its stock spelling by then
create trigger listing_drafts_measures before insert or update of sku on listing_drafts
  for each row execute function private.listing_draft_measures();

/**
 * p_rows: [{sku, measures}] read from a file. Kept for each SKU (the latest import wins), and written into the
 * prepared articles with that SKU, except those marked « prête » (their text no longer changes).
 */
create function public.import_sku_measures(p_rows jsonb, p_file text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.auth_org_id();
  r record;
  v_applied text[] := '{}'; v_pending text[] := '{}'; v_locked text[] := '{}';
  v_draft record;
begin
  if v_org is null then raise exception 'Non connecté' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Liste de mesures attendue'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Trop de SKU dans un fichier (5 000 au plus)'; end if;
  for r in
    select distinct on (upper(trim(e->>'sku'))) trim(e->>'sku') as sku, left(trim(e->>'measures'), 5000) as measures
    from jsonb_array_elements(p_rows) e
    where trim(coalesce(e->>'sku', '')) ~ '^\S{1,64}$' and trim(coalesce(e->>'measures', '')) <> ''
    order by upper(trim(e->>'sku'))
  loop
    delete from sku_measures where org_id = v_org and upper(sku) = upper(r.sku) and sku <> r.sku;
    insert into sku_measures(org_id, sku, measures, file_name, updated_at, updated_by)
    values (v_org, r.sku, r.measures, left(p_file, 300), now(), auth.uid())
    on conflict (org_id, sku) do update set measures = excluded.measures, file_name = excluded.file_name, updated_at = now(), updated_by = auth.uid();
    select id, sku, status into v_draft from listing_drafts where org_id = v_org and upper(sku) = upper(r.sku);
    if v_draft.id is null then
      v_pending := v_pending || r.sku;
    elsif v_draft.status in ('pret', 'envoye') then
      v_locked := v_locked || v_draft.sku;
    else
      update listing_drafts set measures = r.measures where id = v_draft.id;
      v_applied := v_applied || v_draft.sku;
    end if;
  end loop;
  return jsonb_build_object('applied', to_jsonb(v_applied), 'pending', to_jsonb(v_pending), 'locked', to_jsonb(v_locked));
end $$;
revoke all on function public.import_sku_measures(jsonb, text) from public, anon;
grant execute on function public.import_sku_measures(jsonb, text) to authenticated;

-- detects that this update is installed
create function public.sku_measures_ready() returns boolean language sql stable as $$ select true $$;
revoke all on function public.sku_measures_ready() from public, anon;
grant execute on function public.sku_measures_ready() to authenticated;
