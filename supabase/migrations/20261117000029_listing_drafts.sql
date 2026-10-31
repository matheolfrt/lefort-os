-- Lefort OS — annonces en préparation. Photos added in bulk land in a pile; the team groups them into articles by SKU,
-- pastes the measurements, and Lefort OS writes the title and description (from the shop's model, or with AI from the
-- photos). A draft marked « prête » waits for the extension, which will later put it in draft on Vinted.

create table listing_drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.auth_org_id() references organizations(id),
  sku text not null check (sku ~ '^\S{1,64}$'),
  item_id uuid references items(id) on delete set null,      -- the stock article with this SKU, when there is one
  measures text not null default '' check (length(measures) <= 5000),
  title text not null default '' check (length(title) <= 200),
  description text not null default '' check (length(description) <= 10000),
  price_cents bigint check (price_cents is null or price_cents > 0),
  status text not null default 'a_faire' check (status in ('a_faire', 'genere', 'pret', 'envoye')),
  generated_by text check (generated_by in ('modele', 'ia')),
  generated_at timestamptz,
  to_check text[] not null default '{}',                     -- what the AI could not read on the photos
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, sku)
);
create index listing_drafts_org_idx on listing_drafts(org_id, status, created_at);
create trigger listing_drafts_touch before update on listing_drafts for each row execute function private.touch_updated_at();

-- the SKU finds its stock article (exact, else ignoring case: then it takes the stock's spelling)
create function private.listing_draft_item() returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_sku text;
begin
  new.sku := trim(new.sku);
  if tg_op = 'INSERT' or new.sku is distinct from old.sku then
    select id, sku into v_id, v_sku from items where org_id = new.org_id and sku = new.sku;
    if v_id is null then
      select id, sku into v_id, v_sku from items where org_id = new.org_id and upper(sku) = upper(new.sku) order by created_at limit 1;
    end if;
    new.item_id := v_id;
    new.sku := coalesce(v_sku, new.sku);
  end if;
  return new;
end $$;
create trigger listing_drafts_item before insert or update of sku on listing_drafts
  for each row execute function private.listing_draft_item();

create table draft_photos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.auth_org_id() references organizations(id),
  draft_id uuid references listing_drafts(id) on delete set null,  -- null: still in the pile
  storage_path text not null unique,
  file_name text check (length(file_name) <= 300),
  position int not null default 0,
  width int,
  height int,
  bytes int,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index draft_photos_org_idx on draft_photos(org_id, draft_id, position);

-- the shop's model title and description, and its instructions for the AI
create table listing_templates (
  org_id uuid primary key default public.auth_org_id() references organizations(id),
  title_template text not null default '{categorie} {marque} {couleur} {taille}' check (length(title_template) <= 500),
  description_template text not null default '' check (length(description_template) <= 10000),
  instructions text not null default '' check (length(instructions) <= 5000),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id)
);
create trigger listing_templates_touch before update on listing_templates for each row execute function private.touch_updated_at();

-- everyone in the shop prepares listings (the photo station is the team's work)
alter table listing_drafts enable row level security;
alter table draft_photos enable row level security;
alter table listing_templates enable row level security;
grant select, insert, delete on listing_drafts, draft_photos, listing_templates to authenticated;
grant update (sku, measures, title, description, price_cents, status, generated_by, generated_at, to_check) on listing_drafts to authenticated;
grant update (draft_id, position) on draft_photos to authenticated;
grant update (title_template, description_template, instructions, updated_by) on listing_templates to authenticated;
do $$
declare t text;
begin
  foreach t in array array['listing_drafts', 'draft_photos', 'listing_templates'] loop
    execute format('create policy %I on %I for select to authenticated using (org_id = (select public.auth_org_id()))', t || '_read', t);
    execute format('create policy %I on %I for insert to authenticated with check (org_id = (select public.auth_org_id()))', t || '_insert', t);
    execute format('create policy %I on %I for update to authenticated using (org_id = (select public.auth_org_id())) with check (org_id = (select public.auth_org_id()))', t || '_update', t);
    execute format('create policy %I on %I for delete to authenticated using (org_id = (select public.auth_org_id()))', t || '_delete', t);
  end loop;
end $$;

-- a photo can only join a draft of the same shop
create function private.draft_photo_check() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.draft_id is not null and not exists (select 1 from listing_drafts where id = new.draft_id and org_id = new.org_id) then
    raise exception 'Article inconnu' using errcode = '23503';
  end if;
  return new;
end $$;
create trigger draft_photos_check before insert or update of draft_id on draft_photos
  for each row execute function private.draft_photo_check();

-- what the stock knows about a draft's article, with labels, for the model and the AI
create function public.listing_draft_context(p_id uuid) returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'sku', d.sku,
    'item', case when i.id is null then null else jsonb_build_object(
      'categorie', c.name,
      'marque', nullif(b.name, 'Sans marque'),
      'taille', i.size_label,
      'taille_pantalon', i.trouser_size_label,
      'etat', i.condition,
      'couleur', col.value,
      'motif', nullif(pat.value, 'Uni'),
      'matiere', coalesce(nullif(i.composition, ''), mat.value),
      'defauts', nullif(i.defects, ''),
      'prix_cents', i.list_price_cents,
      'mesures', coalesce((select jsonb_agg(jsonb_build_object('label', md.label, 'mm', m.value_mm) order by md.sort)
                           from item_measurements m join measurement_definitions md on md.id = m.definition_id
                           where m.item_id = i.id), '[]'::jsonb)) end)
  from listing_drafts d
  left join items i on i.id = d.item_id
  left join categories c on c.id = i.category_id
  left join brands b on b.id = i.brand_id
  left join attribute_values col on col.id = i.color_id
  left join attribute_values pat on pat.id = i.pattern_id
  left join attribute_values mat on mat.id = i.material_id
  where d.id = p_id and d.org_id = public.auth_org_id()
$$;
revoke all on function public.listing_draft_context(uuid) from public, anon;
grant execute on function public.listing_draft_context(uuid) to authenticated;

-- detects that this update is installed
create function public.listing_drafts_ready() returns boolean language sql stable as $$ select true $$;
revoke all on function public.listing_drafts_ready() from public, anon;
grant execute on function public.listing_drafts_ready() to authenticated;
