-- Lefort OS — delete / restore items, CSV import of the inventory
-- Deleting is a soft delete (deleted_at): the item leaves every list and count but stays restorable.
-- Items with a sale are never deleted: they belong to the accounting history.

create function public.delete_items(p_item_ids uuid[], p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager'); v_item items; v_id uuid; v_ok int := 0; v_errors jsonb := '[]';
begin
  if cardinality(p_item_ids) > 500 then
    raise exception using errcode = 'LF422', message = 'Maximum 500 articles à la fois.';
  end if;
  foreach v_id in array p_item_ids loop
    select * into v_item from items where id = v_id and org_id = v_org and deleted_at is null;
    continue when v_item.id is null;
    begin
      if v_item.status in ('sold', 'shipped', 'completed') or exists (select 1 from order_lines where item_id = v_id) then
        raise exception using errcode = 'LF409', message = 'Article vendu : il reste dans l''historique comptable et ne peut pas être supprimé.';
      end if;
      update listings set status = 'delisted', ended_at = now()
       where item_id = v_id and status in ('draft', 'active', 'reserved');
      update items set deleted_at = now(), claimed_by = null, claimed_until = null where id = v_id;
      insert into item_events(org_id, item_id, type, from_status, to_status, station, actor_id, payload)
      values (v_org, v_id, 'deleted', v_item.status, v_item.status, 'stock', auth.uid(),
              jsonb_build_object('reason', nullif(trim(coalesce(p_reason, '')), '')));
      v_ok := v_ok + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object('sku', v_item.sku, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('updated', v_ok, 'errors', v_errors);
end $$;

create function public.restore_items(p_item_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager'); v_n int;
begin
  -- the listing was taken down on deletion: an item that was on sale comes back "prêt à publier"
  with r as (
    update items i set deleted_at = null,
           status = case when i.status in ('listed', 'reserved') then 'listing_ready'::item_status else i.status end,
           status_changed_at = case when i.status in ('listed', 'reserved') then now() else i.status_changed_at end
     where i.id = any(p_item_ids) and i.org_id = v_org and i.deleted_at is not null
    returning i.id, i.org_id, i.status
  )
  insert into item_events(org_id, item_id, type, from_status, to_status, station, actor_id)
  select org_id, id, 'restored', status, status, 'stock', auth.uid() from r;
  get diagnostics v_n = row_count;
  return jsonb_build_object('updated', v_n, 'errors', '[]'::jsonb);
end $$;

-- ── CSV import ──────────────────────────────────────────
-- Rows arrive normalised by the app: { sku, category, brand, size, condition, color, material, pattern, title,
-- description, price_cents, min_price_cents, status, location, vinted_url, cost_cents } (all optional).
-- New SKUs are created in p_batch_id (or a new "stock existant" batch); known SKUs are updated when
-- p_update_existing, field by field (empty cells leave the current value). Status is only set on creation.
create function private.attr_for(p_org uuid, p_kind attr_kind, p_value text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from attribute_values where org_id = p_org and kind = p_kind and lower(value) = lower(trim(p_value)) limit 1
$$;

create function public.import_items(p_rows jsonb, p_batch_id uuid default null, p_update_existing boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := private.require_role('manager');
  v_batch uuid := p_batch_id; v_supplier uuid; r jsonb; v_i int := 0; v_item items; v_sku text; v_status item_status;
  v_loc uuid; v_cat uuid; v_out jsonb := '[]'; v_created int := 0; v_updated int := 0; v_errors jsonb := '[]';
  v_url text; v_ext text; v_auto_batch boolean := false; v_code text;
begin
  if jsonb_array_length(p_rows) > 2000 then
    raise exception using errcode = 'LF422', message = 'Maximum 2000 lignes par import.';
  end if;
  if v_batch is not null and not exists (select 1 from batches where id = v_batch and org_id = v_org and status = 'open') then
    raise exception using errcode = 'LF404', message = 'Lot introuvable ou clôturé.';
  end if;

  -- new items need a batch: create the "stock existant" one up front (outside the per-row rollback)
  if v_batch is null and exists (
    select 1 from jsonb_array_elements(p_rows) x
     where not exists (select 1 from items where org_id = v_org and sku = upper(nullif(trim(x->>'sku'), '')))
  ) then
    insert into suppliers(org_id, name, notes) values (v_org, 'Stock existant', 'Articles présents avant Lefort OS')
      on conflict (org_id, lower(name)) do nothing;
    select id into v_supplier from suppliers where org_id = v_org and lower(name) = 'stock existant';
    v_code := 'LOT-IMPORT-' || to_char(now() at time zone 'Europe/Paris', 'YYYYMMDD-HH24MI');
    if exists (select 1 from batches where org_id = v_org and code = v_code) then
      v_code := v_code || '-' || upper(substr(md5(random()::text), 1, 4));
    end if;
    insert into batches(org_id, code, supplier_id, purchased_at, allocation_method, kind, notes, created_by)
    values (v_org, v_code, v_supplier,
            current_date, 'equal', 'opening_stock', 'Import CSV de l''inventaire', auth.uid())
    returning id into v_batch;
    v_auto_batch := true;
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_sku := upper(nullif(trim(r->>'sku'), ''));
    begin
      select * into v_item from items where org_id = v_org and sku = v_sku;

      if v_item.id is not null then
        -- ── existing SKU
        if v_item.deleted_at is not null then
          raise exception using errcode = 'LF409', message = 'Article supprimé : restaurez-le depuis la corbeille.';
        end if;
        if not p_update_existing then
          v_out := v_out || jsonb_build_object('row', v_i, 'sku', v_sku, 'action', 'skipped');
          continue;
        end if;
        -- sold items belong to the accounting history: an exported file re-imported leaves them as they are
        if v_item.status in ('sold', 'shipped', 'completed') then
          v_out := v_out || jsonb_build_object('row', v_i, 'sku', v_sku, 'action', 'skipped');
          continue;
        end if;
        if (r->>'min_price_cents')::bigint > coalesce((r->>'price_cents')::bigint, v_item.list_price_cents) then
          raise exception using errcode = 'LF422', message = 'Le prix minimum dépasse le prix affiché.';
        end if;
        update items set
          category_id = coalesce((select id from categories where org_id = v_org and lower(name) = lower(trim(r->>'category'))), category_id),
          brand_id = coalesce(private.brand_for(v_org, r->>'brand'), brand_id),
          size_label = coalesce(nullif(trim(r->>'size'), ''), size_label),
          condition = coalesce((nullif(r->>'condition', ''))::item_condition, condition),
          color_id = coalesce(private.attr_for(v_org, 'color', r->>'color'), color_id),
          material_id = coalesce(private.attr_for(v_org, 'material', r->>'material'), material_id),
          pattern_id = coalesce(private.attr_for(v_org, 'pattern', r->>'pattern'), pattern_id),
          title = coalesce(nullif(r->>'title', ''), title),
          description = coalesce(nullif(r->>'description', ''), description),
          list_price_cents = coalesce((r->>'price_cents')::bigint, list_price_cents),
          min_price_cents = coalesce((r->>'min_price_cents')::bigint, min_price_cents)
        where id = v_item.id;
        if (r->>'price_cents') is not null then
          update listings set price_cents = (r->>'price_cents')::bigint where item_id = v_item.id and status in ('active', 'reserved');
        end if;
        if nullif(trim(r->>'location'), '') is not null then
          select id into v_loc from locations where org_id = v_org and code = upper(trim(r->>'location')) and active;
          if v_loc is null then raise exception using errcode = 'LF404', message = format('Emplacement %s inconnu.', r->>'location'); end if;
          perform private.move(v_item.id, v_loc, 'bulk');
        end if;
        -- an unchanged cost (round trip) keeps the automatic allocation
        if (r->>'cost_cents') is not null
           and (r->>'cost_cents')::bigint is distinct from (select allocated_cost_cents from item_costs where item_id = v_item.id) then
          if exists (select 1 from batches where id = v_item.batch_id and status = 'open') then
            update item_costs set allocated_cost_cents = (r->>'cost_cents')::bigint, manual = true, updated_at = now() where item_id = v_item.id;
            perform private.allocate_batch_costs(v_item.batch_id);
          end if;
        end if;
        v_updated := v_updated + 1;
        v_out := v_out || jsonb_build_object('row', v_i, 'sku', v_sku, 'action', 'updated');
        continue;
      end if;

      -- ── new item
      if coalesce(nullif(r->>'status', ''), 'received') not in ('received', 'listing_ready', 'listed') then
        raise exception using errcode = 'LF422', message = 'Statut d''un nouvel article : Reçu, Prêt à publier ou En ligne.';
      end if;
      v_status := coalesce(nullif(r->>'status', ''), 'received')::item_status;
      v_url := nullif(trim(r->>'vinted_url'), '');
      if v_status = 'listed' and (r->>'price_cents') is null then
        raise exception using errcode = 'LF422', message = 'Prix obligatoire pour un article en ligne.';
      end if;
      if (r->>'min_price_cents')::bigint > (r->>'price_cents')::bigint then
        raise exception using errcode = 'LF422', message = 'Le prix minimum dépasse le prix affiché.';
      end if;

      if v_sku is null then
        select x into v_sku from public.issue_sku_labels(v_batch, 1) x;
      else
        if v_sku !~ '^[A-Z0-9-]{3,30}$' then
          raise exception using errcode = 'LF422', message = 'SKU invalide (lettres, chiffres et tirets, 3 à 30 caractères).';
        end if;
        insert into sku_labels(sku, org_id, batch_id, issued_by) values (v_sku, v_org, v_batch, auth.uid())
          on conflict (sku) do nothing;
        if not exists (select 1 from sku_labels where sku = v_sku and org_id = v_org) then
          raise exception using errcode = 'LF409', message = 'Ce SKU est déjà utilisé par une autre organisation.';
        end if;
      end if;

      if nullif(trim(r->>'location'), '') is not null then
        select id into v_loc from locations where org_id = v_org and code = upper(trim(r->>'location')) and active;
        if v_loc is null then raise exception using errcode = 'LF404', message = format('Emplacement %s inconnu.', r->>'location'); end if;
      elsif v_status = 'received' then
        select id into v_loc from locations where org_id = v_org and auto_for_status = 'received';
      else
        insert into locations(org_id, code, label, kind, pick_order)
        values (v_org, 'EMP-A-ETIQUETER', 'Importé : à étiqueter et ranger', 'staging', 0)
        on conflict (org_id, code) do nothing;
        select id into v_loc from locations where org_id = v_org and code = 'EMP-A-ETIQUETER';
      end if;

      v_cat := coalesce((select id from categories where org_id = v_org and lower(name) = lower(trim(r->>'category'))),
                        private.guess_category(v_org, coalesce(r->>'title', '') || ' ' || coalesce(r->>'category', '')));
      insert into items(org_id, sku, batch_id, status, category_id, brand_id, size_label, condition, color_id, material_id,
                        pattern_id, title, description, list_price_cents, min_price_cents, current_location_id,
                        listed_at, created_by, notes)
      values (v_org, v_sku, v_batch, v_status, v_cat, private.brand_for(v_org, r->>'brand'), nullif(trim(r->>'size'), ''),
              (nullif(r->>'condition', ''))::item_condition, private.attr_for(v_org, 'color', r->>'color'),
              private.attr_for(v_org, 'material', r->>'material'), private.attr_for(v_org, 'pattern', r->>'pattern'),
              nullif(r->>'title', ''), nullif(r->>'description', ''), (r->>'price_cents')::bigint, (r->>'min_price_cents')::bigint,
              v_loc, case when v_status = 'listed' then now() end, auth.uid(), 'Importé par CSV')
      returning * into v_item;

      if v_status = 'listed' then
        v_ext := substring(v_url from 'vinted\.[a-z.]+/items/([0-9]+)');
        if v_ext is not null and exists (select 1 from listings where channel = 'vinted' and external_id = v_ext) then
          raise exception using errcode = 'LF409', message = 'Cette annonce Vinted est déjà rattachée à un article.';
        end if;
        insert into listings(org_id, item_id, channel, external_id, url, title, price_cents, created_by)
        values (v_org, v_item.id, 'vinted', v_ext, v_url, v_item.title, v_item.list_price_cents, auth.uid());
      end if;
      if v_loc is not null then
        insert into item_location_moves(org_id, item_id, to_location_id, method, moved_by)
        values (v_org, v_item.id, v_loc, 'bulk', auth.uid());
      end if;
      if (r->>'cost_cents') is not null then
        update item_costs set allocated_cost_cents = (r->>'cost_cents')::bigint, manual = true where item_id = v_item.id;
        perform private.allocate_batch_costs(v_batch);
      end if;
      insert into item_events(org_id, item_id, type, to_status, station, actor_id, payload)
      values (v_org, v_item.id, 'imported', v_status, 'csv_import', auth.uid(), '{"source":"csv"}');

      v_created := v_created + 1;
      v_out := v_out || jsonb_build_object('row', v_i, 'sku', v_sku, 'action', 'created');
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', v_i, 'sku', v_sku, 'error', sqlerrm);
    end;
  end loop;
  if v_auto_batch and v_created = 0 then
    delete from sku_labels where batch_id = v_batch;
    delete from batches where id = v_batch;
    v_batch := null;
  end if;
  return jsonb_build_object('batch_id', v_batch, 'created', v_created, 'updated', v_updated, 'rows', v_out, 'errors', v_errors);
end $$;

create or replace function public.vinted_sync_preview(p_listings jsonb, p_complete boolean default true) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager', 'operator', 'listing_operator');
begin
  return (
    with snap as (
      select s->>'external_id' as ext, s->>'state' as state, (s->>'price_cents')::bigint as price, s->>'title' as title,
             (nullif(s->>'listed_at', ''))::timestamptz as listed_at
        from jsonb_array_elements(p_listings) s
       where coalesce(s->>'external_id', '') <> ''
    ),
    known as (
      select distinct on (l.external_id) l.external_id as ext, l.status as listing_status, i.id as item_id, i.sku,
             i.status as item_status, i.list_price_cents,
             i.listed_at as item_listed_at, b.kind as batch_kind
        from listings l join items i on i.id = l.item_id join batches b on b.id = i.batch_id
       where l.org_id = v_org and l.channel = 'vinted' and l.external_id is not null and i.deleted_at is null
       order by l.external_id, l.listed_at desc
    )
    select jsonb_build_object(
      'new', coalesce((select jsonb_agg(s.ext) from snap s
                        where s.state in ('active', 'reserved')
                          -- deleted items count as known: a listing removed from Lefort OS on purpose is not proposed again
                          and not exists (select 1 from listings l2 where l2.org_id = v_org and l2.channel = 'vinted' and l2.external_id = s.ext)), '[]'),
      'sold_on_vinted', coalesce((select jsonb_agg(jsonb_build_object('item_id', k.item_id, 'sku', k.sku, 'external_id', k.ext,
                                     'price_cents', coalesce(s.price, k.list_price_cents), 'title', s.title))
                                   from snap s join known k on k.ext = s.ext
                                  where s.state = 'sold' and k.item_status in ('listing_ready', 'listed', 'reserved')), '[]'),
      'price_changes', coalesce((select jsonb_agg(jsonb_build_object('item_id', k.item_id, 'sku', k.sku,
                                    'old_cents', k.list_price_cents, 'new_cents', s.price))
                                  from snap s join known k on k.ext = s.ext
                                 where s.state in ('active', 'reserved') and k.item_status in ('listed', 'reserved')
                                   and s.price is not null and s.price is distinct from k.list_price_cents), '[]'),
      'reservation_changes', coalesce((select jsonb_agg(jsonb_build_object('item_id', k.item_id, 'sku', k.sku,
                                    'to', case when s.state = 'reserved' then 'reserved' else 'listed' end))
                                  from snap s join known k on k.ext = s.ext
                                 where (s.state = 'reserved' and k.item_status = 'listed')
                                    or (s.state = 'active' and k.item_status = 'reserved')), '[]'),
      'missing_on_vinted', case when p_complete then coalesce((select jsonb_agg(jsonb_build_object('item_id', k.item_id, 'sku', k.sku, 'external_id', k.ext))
                                   from known k
                                  where k.item_status in ('listed', 'reserved') and k.listing_status in ('active', 'reserved')
                                    and not exists (select 1 from snap s where s.ext = k.ext)), '[]') else '[]'::jsonb end,
      -- items imported before Vinted dates were read: their age restarts at the import day
      'date_fixes', coalesce((select jsonb_agg(jsonb_build_object('item_id', k.item_id, 'sku', k.sku, 'listed_at', s.listed_at))
                                from snap s join known k on k.ext = s.ext
                               where k.batch_kind = 'opening_stock' and s.listed_at is not null
                                 and s.listed_at < k.item_listed_at - interval '1 day'), '[]'),
      'already_known', (select count(*) from snap s join known k on k.ext = s.ext),
      'sold_history_ignored', (select count(*) from snap s where s.state = 'sold' and not exists (select 1 from known k where k.ext = s.ext))
    )
  );
end $$;

revoke all on function public.delete_items(uuid[], text), public.restore_items(uuid[]),
  public.import_items(jsonb, uuid, boolean) from public, anon;
grant execute on function public.delete_items(uuid[], text), public.restore_items(uuid[]),
  public.import_items(jsonb, uuid, boolean) to authenticated;
revoke all on function private.attr_for(uuid, attr_kind, text) from public, anon, authenticated;
