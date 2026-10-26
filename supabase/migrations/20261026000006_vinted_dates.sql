-- Lefort OS — Vinted listing dates
-- The wardrobe list has no creation date; the extension now sends the upload date of the listing photos.
-- Sync corrects the age of items imported before that (their age had restarted at the import day).

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
                        where s.state in ('active', 'reserved') and not exists (select 1 from known k where k.ext = s.ext)), '[]'),
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

-- Applies the non-financial updates of a preview: Vinted prices and reservations
create or replace function public.vinted_apply_updates(p_listings jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager', 'operator', 'listing_operator'); v_preview jsonb; r jsonb;
  v_prices int := 0; v_res int := 0; v_dates int := 0;
begin
  v_preview := public.vinted_sync_preview(p_listings, false);
  for r in select * from jsonb_array_elements(v_preview->'price_changes') loop
    update items set list_price_cents = (r->>'new_cents')::bigint,
                     min_price_cents = case when min_price_cents > (r->>'new_cents')::bigint then null else min_price_cents end
     where id = (r->>'item_id')::uuid and org_id = v_org;
    update listings set price_cents = (r->>'new_cents')::bigint
     where item_id = (r->>'item_id')::uuid and channel = 'vinted' and status in ('active', 'reserved');
    v_prices := v_prices + 1;
  end loop;
  for r in select * from jsonb_array_elements(v_preview->'reservation_changes') loop
    perform private.transition((r->>'item_id')::uuid, (r->>'to')::item_status, 'vinted_sync', '{"source":"vinted"}');
    update listings set status = case when r->>'to' = 'reserved' then 'reserved' else 'active' end::listing_status
     where item_id = (r->>'item_id')::uuid and channel = 'vinted' and status in ('active', 'reserved');
    v_res := v_res + 1;
  end loop;
  for r in select * from jsonb_array_elements(v_preview->'date_fixes') loop
    update items set listed_at = (r->>'listed_at')::timestamptz, received_at = (r->>'listed_at')::timestamptz
     where id = (r->>'item_id')::uuid and org_id = v_org;
    update listings set listed_at = (r->>'listed_at')::timestamptz
     where item_id = (r->>'item_id')::uuid and channel = 'vinted';
    v_dates := v_dates + 1;
  end loop;
  return jsonb_build_object('prices_updated', v_prices, 'reservations_updated', v_res, 'dates_updated', v_dates);
end $$;
