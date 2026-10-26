-- Lefort OS — Vinted import & resynchronisation (used by the Chrome extension)
-- The extension reads the seller's own wardrobe and sends a normalised snapshot:
--   [{ "external_id": "4812345678", "url": "...", "title": "...", "description": "...",
--      "price_cents": 4500, "brand": "Hugo Boss", "size": "50", "condition": "very_good",
--      "state": "active" | "reserved" | "sold" | "hidden", "listed_at": "2026-09-01T10:00:00Z",
--      "photos": ["https://images1.vinted.net/..."] }, ...]
-- Listings are matched on their Vinted id, so running an import twice never duplicates an item.

-- Stock that existed before Lefort OS is not a purchase of the day: keep it out of the registre des achats
alter table batches add column kind text not null default 'purchase' check (kind in ('purchase', 'opening_stock'));

create or replace view v_registre_achats with (security_invoker = true) as
select b.org_id, b.purchased_at as date_achat, s.name as fournisseur, b.invoice_number as reference_facture,
       'Lot ' || b.code as nature,
       (select coalesce(sum(amount_cents), 0) from batch_cost_lines where batch_id = b.id) as montant_cents,
       b.payment_method as mode_reglement
  from batches b join suppliers s on s.id = b.supplier_id
 where b.kind = 'purchase'
union all
select a.org_id, (a.created_at at time zone 'Europe/Paris')::date, s.name, null, 'Ajustement lot ' || b.code || ' : ' || a.reason, a.amount_cents, null
  from batch_cost_adjustments a join batches b on b.id = a.batch_id join suppliers s on s.id = b.supplier_id
 where b.kind = 'purchase'
union all
select e.org_id, e.spent_on, e.supplier, e.invoice_number, 'Frais : ' || e.category, e.amount_cents, e.payment_method
  from expenses e;

-- Category from a listing title ("Blazer Hugo Boss laine T50" → Blazer); falls back to "Autre"
create function private.guess_category(p_org uuid, p_title text) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.id from categories c
      where c.org_id = p_org and c.active and c.name = case
        when p_title ~* '(costume|complet|suit)' then 'Costume'
        when p_title ~* '(blazer|veston|veste de costume|sport ?coat)' then 'Blazer'
        when p_title ~* '(manteau|pardessus|caban|trench)' then 'Manteau'
        when p_title ~* '(gilet|waistcoat)' then 'Gilet'
        when p_title ~* '(chemise|shirt)' then 'Chemise'
        when p_title ~* '(pantalon|chino|trousers)' then 'Pantalon'
        when p_title ~* '(cravate|noeud|nœud|pochette|bretelles)' then 'Cravate / accessoire'
        when p_title ~* 'veste' then 'Blazer'
      end limit 1),
    (select c.id from categories c where c.org_id = p_org and c.name = 'Autre' limit 1))
$$;

create function private.brand_for(p_org uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := nullif(trim(p_name), '');
begin
  if v_name is null then return null; end if;
  select id into v_id from brands
   where org_id = p_org and (lower(name) = lower(v_name) or lower(v_name) = any(select lower(a) from unnest(aliases) a))
   limit 1;
  if v_id is null then
    insert into brands(org_id, name) values (p_org, v_name)
      on conflict (org_id, lower(name)) do update set name = brands.name
      returning id into v_id;
  end if;
  return v_id;
end $$;

-- Read-only comparison between the Vinted wardrobe and Lefort OS.
-- p_complete = the snapshot holds every listing (needed to report listings that disappeared from Vinted).
create function public.vinted_sync_preview(p_listings jsonb, p_complete boolean default true) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager', 'operator', 'listing_operator');
begin
  return (
    with snap as (
      select s->>'external_id' as ext, s->>'state' as state, (s->>'price_cents')::bigint as price, s->>'title' as title
        from jsonb_array_elements(p_listings) s
       where coalesce(s->>'external_id', '') <> ''
    ),
    known as (
      select distinct on (l.external_id) l.external_id as ext, l.status as listing_status, i.id as item_id, i.sku,
             i.status as item_status, i.list_price_cents
        from listings l join items i on i.id = l.item_id
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
      'already_known', (select count(*) from snap s join known k on k.ext = s.ext),
      'sold_history_ignored', (select count(*) from snap s where s.state = 'sold' and not exists (select 1 from known k where k.ext = s.ext))
    )
  );
end $$;

-- Applies the non-financial updates of a preview: Vinted prices and reservations
create function public.vinted_apply_updates(p_listings jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager', 'operator', 'listing_operator'); v_preview jsonb; r jsonb;
  v_prices int := 0; v_res int := 0;
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
  return jsonb_build_object('prices_updated', v_prices, 'reservations_updated', v_res);
end $$;

-- Creates Lefort OS items for Vinted listings that are not known yet.
-- They land in an "opening stock" batch, status En ligne, at EMP-A-ETIQUETER until a label is stuck on them.
create function public.vinted_import(p_listings jsonb, p_cost_cents_each bigint default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := private.require_role('manager');
  v_supplier uuid; v_batch uuid; v_loc uuid; v_item items; v_sku text; s jsonb; v_out jsonb := '[]'; v_n int := 0;
  v_state text; v_when timestamptz;
begin
  if p_cost_cents_each < 0 then raise exception using errcode = 'LF422', message = 'Coût invalide.'; end if;

  insert into locations(org_id, code, label, kind, pick_order)
  values (v_org, 'EMP-A-ETIQUETER', 'Importé de Vinted : à étiqueter et ranger', 'staging', 0)
  on conflict (org_id, code) do nothing;
  select id into v_loc from locations where org_id = v_org and code = 'EMP-A-ETIQUETER';

  insert into suppliers(org_id, name, notes) values (v_org, 'Stock existant', 'Articles déjà en ligne avant Lefort OS')
  on conflict (org_id, lower(name)) do nothing;
  select id into v_supplier from suppliers where org_id = v_org and lower(name) = 'stock existant';

  select id into v_batch from batches where org_id = v_org and kind = 'opening_stock' and status = 'open'
   order by created_at desc limit 1;
  if v_batch is null then
    insert into batches(org_id, code, supplier_id, purchased_at, allocation_method, kind, notes, created_by)
    values (v_org, 'LOT-VINTED-' || to_char(now() at time zone 'Europe/Paris', 'YYYYMMDD-HH24MI'), v_supplier,
            current_date, 'equal', 'opening_stock', 'Import du dressing Vinted (coût estimé)', auth.uid())
    returning id into v_batch;
  end if;

  for s in select * from jsonb_array_elements(p_listings) loop
    v_state := s->>'state';
    continue when coalesce(s->>'external_id', '') = '' or v_state not in ('active', 'reserved');
    continue when exists (select 1 from listings where org_id = v_org and channel = 'vinted' and external_id = s->>'external_id');

    select x into v_sku from public.issue_sku_labels(v_batch, 1) x;
    v_when := coalesce((s->>'listed_at')::timestamptz, now());
    insert into items(org_id, sku, batch_id, status, status_changed_at, category_id, brand_id, size_label, condition,
                      title, description, list_price_cents, current_location_id, received_at, listed_at, created_by, notes)
    values (v_org, v_sku, v_batch, case when v_state = 'reserved' then 'reserved' else 'listed' end::item_status, now(),
            private.guess_category(v_org, s->>'title'), private.brand_for(v_org, s->>'brand'),
            nullif(trim(s->>'size'), ''), (nullif(s->>'condition', ''))::item_condition,
            nullif(s->>'title', ''), nullif(s->>'description', ''), nullif((s->>'price_cents')::bigint, 0),
            v_loc, v_when, v_when, auth.uid(), 'Importé de Vinted')
    returning * into v_item;

    insert into listings(org_id, item_id, channel, external_id, url, title, description, price_cents, status, listed_at, created_by)
    values (v_org, v_item.id, 'vinted', s->>'external_id', s->>'url', v_item.title, v_item.description, v_item.list_price_cents,
            case when v_state = 'reserved' then 'reserved' else 'active' end::listing_status, v_when, auth.uid());
    insert into item_location_moves(org_id, item_id, to_location_id, method, moved_by)
    values (v_org, v_item.id, v_loc, 'auto', auth.uid());
    insert into item_events(org_id, item_id, type, to_status, station, actor_id, payload)
    values (v_org, v_item.id, 'imported', v_item.status, 'vinted_import', auth.uid(),
            jsonb_build_object('source', 'vinted', 'external_id', s->>'external_id'));

    v_n := v_n + 1;
    v_out := v_out || jsonb_build_object('external_id', s->>'external_id', 'item_id', v_item.id, 'sku', v_sku,
                                         'photos', coalesce(s->'photos', '[]'));
  end loop;

  -- estimated cost of the imported stock, split equally over the batch
  if v_n > 0 and p_cost_cents_each > 0 then
    insert into batch_cost_lines(org_id, batch_id, kind, amount_cents, description, created_by)
    values (v_org, v_batch, 'goods', p_cost_cents_each * v_n, format('Coût estimé : %s articles importés de Vinted', v_n), auth.uid());
  end if;
  update batches set expected_qty = (select count(*) from items where batch_id = v_batch) where id = v_batch;

  return jsonb_build_object('batch_id', v_batch, 'imported', v_out);
end $$;

revoke all on function public.vinted_sync_preview(jsonb, boolean), public.vinted_apply_updates(jsonb),
  public.vinted_import(jsonb, bigint) from public, anon;
grant execute on function public.vinted_sync_preview(jsonb, boolean), public.vinted_apply_updates(jsonb),
  public.vinted_import(jsonb, bigint) to authenticated;
revoke all on function private.guess_category(uuid, text), private.brand_for(uuid, text) from public, anon, authenticated;
