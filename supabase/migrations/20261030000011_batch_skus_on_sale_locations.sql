-- Lefort OS — custom SKUs created with a batch, "put on sale" in bulk, named storage locations.

-- ───────────────────────── Custom SKUs for a batch ─────────────────────────
-- Reserves prefix||start … prefix||(start+count-1) for the batch (e.g. M-1 … M-37) and, when p_create_items,
-- creates the items right away in "Reçu" so the whole batch is in the stock before it is sorted.
create function public.create_batch_skus(p_batch_id uuid, p_prefix text, p_start int default 1, p_count int default 1,
                                         p_create_items boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := private.require_role('manager', 'operator'); v_prefix text := upper(trim(coalesce(p_prefix, '')));
  v_loc uuid; v_taken text; v_skus text[];
begin
  if v_prefix !~ '^[A-Z]{1,6}-?$' then
    raise exception using errcode = 'LF422', message = 'Préfixe invalide : 1 à 6 lettres, éventuellement suivies d''un tiret (ex. M- ou BLZ).';
  end if;
  if p_count not between 1 and 1000 or p_start not between 0 and 99999999 then
    raise exception using errcode = 'LF422', message = 'Entre 1 et 1000 articles, à partir d''un numéro positif.';
  end if;
  if not exists (select 1 from batches where id = p_batch_id and org_id = v_org and status = 'open') then
    raise exception using errcode = 'LF404', message = 'Lot introuvable ou clôturé.';
  end if;
  v_skus := array(select v_prefix || (p_start + g) from generate_series(0, p_count - 1) g);
  select string_agg(sku, ', ') into v_taken from (select sku from sku_labels where sku = any(v_skus) order by sku limit 5) t;
  if v_taken is not null then
    raise exception using errcode = 'LF409', message = format('SKU déjà utilisés : %s. Changez le préfixe ou le numéro de départ.', v_taken);
  end if;

  insert into sku_labels(sku, org_id, batch_id, issued_by)
  select s, v_org, p_batch_id, auth.uid() from unnest(v_skus) s;

  if p_create_items then
    select id into v_loc from locations where org_id = v_org and auto_for_status = 'received' and active;
    with created as (
      insert into items(org_id, sku, batch_id, created_by, current_location_id)
      select v_org, s, p_batch_id, auth.uid(), v_loc from unnest(v_skus) s
      returning id
    ), moves as (
      insert into item_location_moves(org_id, item_id, to_location_id, method, moved_by)
      select v_org, id, v_loc, 'auto', auth.uid() from created where v_loc is not null
    )
    insert into item_events(org_id, item_id, type, to_status, station, actor_id, payload)
    select v_org, id, 'status', 'received', 'batch', auth.uid(), '{"source":"batch_skus"}' from created;
  end if;
  return jsonb_build_object('first', v_skus[1], 'last', v_skus[array_length(v_skus, 1)], 'count', p_count,
                            'items_created', case when p_create_items then p_count else 0 end);
end $$;

-- receive_item: a SKU already created with its batch (still "Reçu") is completed and sorted instead of refused
create or replace function public.receive_item(
  p_batch_id uuid, p_sku text, p_attrs jsonb default '{}',
  p_next item_status default null, p_payload jsonb default '{}'
) returns items
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := private.require_operator(); v_sku text := upper(trim(p_sku));
  v_item items; v_loc uuid;
begin
  if not exists (select 1 from batches where id = p_batch_id and org_id = v_org and status = 'open') then
    raise exception using errcode = 'LF404', message = 'Lot introuvable ou clôturé.';
  end if;
  if v_sku is null or v_sku = '' then
    select s into v_sku from public.issue_sku_labels(p_batch_id, 1) s;
  else
    if not exists (select 1 from sku_labels where sku = v_sku and org_id = v_org) then
      raise exception using errcode = 'LF404', message = format('Étiquette %s inconnue : imprimez-la depuis le lot.', v_sku);
    end if;
    select * into v_item from items where sku = v_sku and org_id = v_org;
    if v_item.id is not null then
      if v_item.status <> 'received' or v_item.deleted_at is not null then
        raise exception using errcode = 'LF409', message = format('L''étiquette %s est déjà utilisée.', v_sku);
      end if;
      -- created in advance with the batch: fill in what the reception saw (empty fields keep their value)
      update items set
        category_id = coalesce((p_attrs->>'category_id')::uuid, category_id),
        brand_id = coalesce((p_attrs->>'brand_id')::uuid, brand_id),
        gender = coalesce(p_attrs->>'gender', gender),
        size_label = coalesce(nullif(p_attrs->>'size_label', ''), size_label),
        trouser_size_label = coalesce(nullif(p_attrs->>'trouser_size_label', ''), trouser_size_label),
        color_id = coalesce((p_attrs->>'color_id')::uuid, color_id),
        pattern_id = coalesce((p_attrs->>'pattern_id')::uuid, pattern_id),
        material_id = coalesce((p_attrs->>'material_id')::uuid, material_id),
        condition = coalesce((p_attrs->>'condition')::item_condition, condition),
        defects = coalesce(nullif(p_attrs->>'defects', ''), defects),
        notes = coalesce(nullif(p_attrs->>'notes', ''), notes)
      where id = v_item.id
      returning * into v_item;
      update batches set received_at = coalesce(received_at, current_date) where id = v_item.batch_id;
      if p_next is not null then
        v_item := private.transition(v_item.id, p_next, 'reception', p_payload);
      end if;
      return v_item;
    end if;
  end if;

  select id into v_loc from locations where org_id = v_org and auto_for_status = 'received' and active;

  insert into items(org_id, sku, batch_id, created_by, current_location_id,
                    category_id, brand_id, gender, size_label, trouser_size_label,
                    color_id, pattern_id, material_id, condition, defects, notes)
  values (v_org, v_sku, p_batch_id, auth.uid(), v_loc,
          (p_attrs->>'category_id')::uuid, (p_attrs->>'brand_id')::uuid,
          coalesce(p_attrs->>'gender', 'men'), nullif(p_attrs->>'size_label', ''),
          nullif(p_attrs->>'trouser_size_label', ''),
          (p_attrs->>'color_id')::uuid, (p_attrs->>'pattern_id')::uuid, (p_attrs->>'material_id')::uuid,
          (p_attrs->>'condition')::item_condition, nullif(p_attrs->>'defects', ''), nullif(p_attrs->>'notes', ''))
  returning * into v_item;

  if v_loc is not null then
    insert into item_location_moves(org_id, item_id, to_location_id, method, moved_by)
    values (v_org, v_item.id, v_loc, 'auto', auth.uid());
  end if;
  insert into item_events(org_id, item_id, type, to_status, station, actor_id)
  values (v_org, v_item.id, 'status', 'received', 'reception', auth.uid());

  update batches set received_at = coalesce(received_at, current_date) where id = p_batch_id;

  if p_next is not null then
    v_item := private.transition(v_item.id, p_next, 'reception', p_payload);
  end if;
  return v_item;
end $$;

-- ───────────────────────── Put on sale in bulk ─────────────────────────
-- Straight to "En ligne" from any step before the sale (sorting, photos, measures and storage are skipped).
-- Sold, discarded or deleted items are refused one by one; the others go through.
create function public.bulk_put_on_sale(p_item_ids uuid[], p_price_cents bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := private.require_role('manager', 'operator', 'listing_operator');
  v_item items; v_id uuid; v_ok int := 0; v_errors jsonb := '[]';
begin
  if cardinality(p_item_ids) > 500 then
    raise exception using errcode = 'LF422', message = 'Maximum 500 articles à la fois.';
  end if;
  if p_price_cents is not null and p_price_cents <= 0 then
    raise exception using errcode = 'LF422', message = 'Prix invalide.';
  end if;
  foreach v_id in array p_item_ids loop
    select * into v_item from items where id = v_id and org_id = v_org and deleted_at is null for update;
    continue when v_item.id is null or v_item.status = 'listed';
    begin
      if v_item.status not in ('received', 'sorted', 'photographed', 'measured', 'listing_ready', 'on_hold', 'returned', 'reserved') then
        raise exception using errcode = 'LF409', message = 'Déjà vendu ou écarté : ne peut pas être mis en vente.';
      end if;
      update items set status = 'listed', status_changed_at = now(), listed_at = coalesce(listed_at, now()),
             status_before_hold = null, hold_reason = null, claimed_by = null, claimed_until = null,
             list_price_cents = coalesce(p_price_cents, list_price_cents),
             min_price_cents = case when p_price_cents is not null and min_price_cents > p_price_cents then null else min_price_cents end
       where id = v_id;
      update listings set status = 'active', ended_at = null where item_id = v_id and status = 'reserved';
      insert into item_events(org_id, item_id, type, from_status, to_status, station, actor_id, payload)
      values (v_org, v_id, 'status', v_item.status, 'listed', 'stock', auth.uid(), '{"bulk":"put_on_sale"}');
      v_ok := v_ok + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object('sku', v_item.sku, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('updated', v_ok, 'errors', v_errors);
end $$;

-- ───────────────────────── Named storage locations ─────────────────────────
-- The name chosen by the user becomes the label code (EMP-PORTANT-HIVER): it is what every screen and label shows.
create function private.location_code(p_name text) returns text
language sql immutable as $$
  select 'EMP-' || trim(both '-' from regexp_replace(upper(translate(trim(p_name),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ', 'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY')),
    '[^A-Z0-9]+', '-', 'g'))
$$;

create function public.save_location(p_id uuid, p_name text, p_label text default null, p_capacity int default null)
returns locations
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager'); v_code text := private.location_code(regexp_replace(coalesce(p_name, ''), '^EMP-', '', 'i'));
        v_loc locations;
begin
  if v_code = 'EMP-' or length(v_code) > 34 then
    raise exception using errcode = 'LF422', message = 'Nom d''emplacement invalide (1 à 30 lettres ou chiffres).';
  end if;
  if p_capacity is not null and p_capacity < 1 then
    raise exception using errcode = 'LF422', message = 'Capacité invalide.';
  end if;
  if exists (select 1 from locations where org_id = v_org and code = v_code and id is distinct from p_id) then
    raise exception using errcode = 'LF409', message = format('Un emplacement s''appelle déjà %s.', substr(v_code, 5));
  end if;
  if p_id is null then
    insert into locations(org_id, code, label, kind, capacity, pick_order)
    values (v_org, v_code, nullif(trim(p_label), ''), 'storage', p_capacity,
            coalesce((select max(pick_order) + 1 from locations where org_id = v_org and kind = 'storage'), 0))
    returning * into v_loc;
  else
    update locations set code = v_code, label = nullif(trim(p_label), ''), capacity = p_capacity
     where id = p_id and org_id = v_org returning * into v_loc;
    if v_loc.id is null then
      raise exception using errcode = 'LF404', message = 'Emplacement introuvable.';
    end if;
  end if;
  return v_loc;
end $$;

-- Removes an empty storage location (kept in history, hidden everywhere)
create function public.archive_location(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager'); v_n int;
begin
  select count(*) into v_n from items where current_location_id = p_id and deleted_at is null and status not in ('shipped', 'completed');
  if v_n > 0 then
    raise exception using errcode = 'LF409', message = format('Emplacement non vide (%s article%s) : déplacez-les d''abord.', v_n, case when v_n > 1 then 's' else '' end);
  end if;
  update locations set active = false where id = p_id and org_id = v_org and kind = 'storage';
  if not found then
    raise exception using errcode = 'LF404', message = 'Seuls les emplacements de stockage peuvent être supprimés.';
  end if;
end $$;

revoke all on function public.create_batch_skus(uuid, text, int, int, boolean), public.bulk_put_on_sale(uuid[], bigint),
  public.save_location(uuid, text, text, int), public.archive_location(uuid) from public, anon;
grant execute on function public.create_batch_skus(uuid, text, int, int, boolean), public.bulk_put_on_sale(uuid[], bigint),
  public.save_location(uuid, text, text, int), public.archive_location(uuid) to authenticated;
