-- Lefort OS — bulk actions from the Stock list.
-- Each item is processed on its own: a refused item (rule not met) is reported and the others still change.

-- Taking a listing down (En ligne → Prêt à publier) must work for items that are not yet in a storage bin,
-- e.g. stock imported from Vinted that still waits for its label.
create or replace function private.guard(p_item items, p_to item_status) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_org organizations; v_missing text; v_count int; v_kind location_kind;
begin
  select * into v_org from organizations where id = p_item.org_id;

  if p_to = 'sorted' and p_item.category_id is null then
    return 'Catégorie obligatoire.';
  end if;

  if p_to in ('photographed', 'measured') and p_item.status in ('sorted', 'returned', 'received') then
    select count(*) into v_count from item_photos where item_id = p_item.id;
    if v_count < v_org.min_photos then
      return format('Au moins %s photos requises (%s actuellement).', v_org.min_photos, v_count);
    end if;
    select string_agg(s->>'label', ', ') into v_missing
      from categories c, jsonb_array_elements(
             coalesce((select shots from shot_lists where id = c.shot_list_id), '[]')) s
     where c.id = p_item.category_id and (s->>'required')::boolean
       and not exists (select 1 from item_photos p where p.item_id = p_item.id and p.shot_key = s->>'key');
    if v_missing is not null then return 'Photos manquantes : ' || v_missing || '.'; end if;
  end if;

  if p_to = 'measured' then
    if p_item.category_id is null then return 'Catégorie obligatoire.'; end if;
    select string_agg(d.label, ', ' order by d.sort) into v_missing
      from categories c join measurement_definitions d on d.template_id = c.measurement_template_id
     where c.id = p_item.category_id and d.required
       and not exists (select 1 from item_measurements m where m.item_id = p_item.id and m.definition_id = d.id);
    if v_missing is not null then return 'Mesures manquantes : ' || v_missing || '.'; end if;
  end if;

  -- storage/data checks apply to items coming off the production line, not to listings taken down
  if p_to = 'listing_ready' and p_item.status in ('measured', 'returned') then
    if p_item.category_id is null or p_item.size_label is null or p_item.condition is null then
      return 'Catégorie, taille et état obligatoires.';
    end if;
    select kind into v_kind from locations where id = p_item.current_location_id;
    if v_kind is distinct from 'storage' then
      return 'L''article doit d''abord être rangé dans un emplacement de stockage.';
    end if;
  end if;

  if p_to = 'listed' then
    if p_item.list_price_cents is null then return 'Prix de vente obligatoire.'; end if;
    if not exists (select 1 from listings where item_id = p_item.id and status in ('active', 'reserved')) then
      return 'Aucune annonce active.';
    end if;
  end if;

  if p_to = 'on_hold' and p_item.status = 'on_hold' then return 'Déjà en attente.'; end if;
  return null;
end $$;

-- A sold item only changes through Ventes (cancellation, return), never by a manual status change:
-- otherwise its sale would stay active while the item is back on sale.
create or replace function public.transition_item(
  p_item_id uuid, p_to item_status, p_expected_version int default null,
  p_station text default null, p_payload jsonb default '{}'
) returns items
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_operator(); v_item items;
begin
  select * into v_item from items where id = p_item_id and org_id = v_org;
  if v_item.id is null then raise exception using errcode = 'LF404', message = 'Article introuvable.'; end if;
  if p_expected_version is not null and v_item.version <> p_expected_version then
    raise exception using errcode = 'LF412', message = 'Article modifié entre-temps par quelqu''un d''autre. Rechargez.';
  end if;
  if v_item.status in ('sold', 'shipped', 'completed') then
    raise exception using errcode = 'LF409', message = 'Article vendu : annulation ou retour depuis l''écran Ventes.';
  end if;
  if private.internal_only(p_to) then
    raise exception using errcode = 'LF409', message = 'Utilisez l''écran Ventes / Expédition pour ce changement.';
  end if;
  return private.transition(p_item_id, p_to, p_station, p_payload);
end $$;

-- p_to = null releases items that are on hold back to the step they were at
create function public.bulk_transition(p_item_ids uuid[], p_to item_status, p_payload jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := private.require_operator(); v_id uuid; v_item items; v_target item_status;
  v_ok int := 0; v_errors jsonb := '[]';
begin
  if coalesce(cardinality(p_item_ids), 0) = 0 then return jsonb_build_object('updated', 0, 'errors', '[]'::jsonb); end if;
  if cardinality(p_item_ids) > 500 then
    raise exception using errcode = 'LF422', message = 'Maximum 500 articles à la fois.';
  end if;
  if p_to is not null and private.internal_only(p_to) then
    raise exception using errcode = 'LF409', message = 'Vendu / expédié / terminé / retourné se règlent depuis Ventes et Expédition.';
  end if;

  foreach v_id in array p_item_ids loop
    select * into v_item from items where id = v_id and org_id = v_org and deleted_at is null;
    continue when v_item.id is null;
    v_target := coalesce(p_to, v_item.status_before_hold);
    begin
      if v_target is null then
        raise exception using errcode = 'LF409', message = 'Cet article n''est pas en attente.';
      end if;
      if v_item.status in ('sold', 'shipped', 'completed') then
        raise exception using errcode = 'LF409', message = 'Article vendu : annulation ou retour depuis l''écran Ventes.';
      end if;
      continue when v_item.status = v_target;
      -- keep the Vinted listing in step with the item
      if v_target = 'listing_ready' and v_item.status in ('listed', 'reserved') then
        update listings set status = 'delisted', ended_at = now()
         where item_id = v_id and status in ('draft', 'active', 'reserved');
      elsif v_target = 'reserved' then
        update listings set status = 'reserved' where item_id = v_id and status = 'active';
      elsif v_target = 'listed' and v_item.status = 'reserved' then
        update listings set status = 'active' where item_id = v_id and status = 'reserved';
      end if;
      perform private.transition(v_id, v_target, 'stock', coalesce(p_payload, '{}'));
      v_ok := v_ok + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object('sku', v_item.sku, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('updated', v_ok, 'errors', v_errors);
end $$;

create function public.bulk_move(p_item_ids uuid[], p_location_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_operator(); v_id uuid; v_sku text; v_ok int := 0; v_errors jsonb := '[]';
begin
  if cardinality(p_item_ids) > 500 then
    raise exception using errcode = 'LF422', message = 'Maximum 500 articles à la fois.';
  end if;
  if not exists (select 1 from locations where org_id = v_org and code = upper(trim(p_location_code)) and active) then
    raise exception using errcode = 'LF404', message = format('Emplacement %s inconnu.', upper(trim(p_location_code)));
  end if;
  foreach v_id in array p_item_ids loop
    select sku into v_sku from items where id = v_id and org_id = v_org;
    continue when v_sku is null;
    begin
      perform public.move_item(v_id, p_location_code, 'bulk');
      v_ok := v_ok + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object('sku', v_sku, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('updated', v_ok, 'errors', v_errors);
end $$;

revoke all on function public.bulk_transition(uuid[], item_status, jsonb), public.bulk_move(uuid[], text) from public, anon;
grant execute on function public.bulk_transition(uuid[], item_status, jsonb), public.bulk_move(uuid[], text) to authenticated;
