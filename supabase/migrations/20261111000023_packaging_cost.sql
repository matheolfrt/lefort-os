-- Lefort OS — the packaging of each parcel is a real cost of every sale: 0,15 € by default, set in Paramètres.
-- A sale recorded without a packaging amount (form left empty, CSV without the column, Vinted synchronisation) now
-- takes this amount, once per order (one parcel); an amount typed for a sale, 0 included, is kept as typed.
-- Sales already recorded are not changed.

alter table organizations add column if not exists packaging_cost_cents bigint not null default 15
  check (packaging_cost_cents >= 0);
-- changed by managers in Paramètres (the update policy on organizations is for managers)
grant update (packaging_cost_cents) on organizations to authenticated;

create or replace function public.record_sale(
  p_item_ids uuid[], p_gross_cents bigint,
  p_sold_at timestamptz default now(), p_channel text default 'vinted',
  p_external_order_id text default null, p_buyer text default null,
  p_platform_fee_cents bigint default null, p_promotion_fee_cents bigint default 0,
  p_shipping_cost_cents bigint default 0, p_packaging_cost_cents bigint default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := private.require_role('manager', 'operator', 'listing_operator');
  v_org organizations; v_order uuid; v_ids uuid[]; v_w numeric[]; v_costs bigint[];
  v_alloc bigint[]; v_tax bigint := 0; v_fee bigint; i int; v_bad text;
begin
  if p_item_ids is null or cardinality(p_item_ids) = 0 then
    raise exception using errcode = 'LF422', message = 'Aucun article sélectionné.';
  end if;
  if p_gross_cents is null or p_gross_cents < 0 then
    raise exception using errcode = 'LF422', message = 'Montant de vente invalide.';
  end if;
  select * into v_org from organizations where id = v_org_id;

  perform 1 from items where id = any(p_item_ids) and org_id = v_org_id order by id for update;
  select string_agg(sku || ' (' || status || ')', ', ') into v_bad from items
   where id = any(p_item_ids) and (org_id <> v_org_id or deleted_at is not null
         or status not in ('listing_ready', 'listed', 'reserved'));
  if v_bad is not null then
    raise exception using errcode = 'LF409', message = 'Articles non vendables : ' || v_bad || '.';
  end if;
  if (select count(*) from items where id = any(p_item_ids) and org_id = v_org_id) <> cardinality(array(select distinct unnest(p_item_ids))) then
    raise exception using errcode = 'LF404', message = 'Article introuvable.';
  end if;

  select array_agg(it.id order by it.sku), array_agg(coalesce(it.list_price_cents, 1)::numeric order by it.sku),
         array_agg(coalesce(ic.allocated_cost_cents, 0) order by it.sku)
    into v_ids, v_w, v_costs
    from items it left join item_costs ic on ic.item_id = it.id
   where it.id = any(p_item_ids);
  v_alloc := private.allocate_cents(p_gross_cents, v_w);

  if v_org.vat_regime = 'margin_scheme' then
    for i in 1..array_length(v_ids, 1) loop
      v_tax := v_tax + greatest(round((v_alloc[i] - v_costs[i]) * 20.0 / 120.0), 0)::bigint;
    end loop;
  end if;
  v_fee := coalesce(p_platform_fee_cents,
            case when p_channel = 'vinted'
                 then round(p_gross_cents * v_org.vinted_fee_pct / 100)::bigint + v_org.vinted_fee_fixed_cents
                 else 0 end);

  insert into orders(org_id, channel, external_order_id, buyer_handle, sold_at, gross_cents,
                     platform_fee_cents, promotion_fee_cents, shipping_cost_cents, packaging_cost_cents,
                     tax_cents, vat_regime_at_sale, notes, created_by)
  values (v_org_id, p_channel, nullif(p_external_order_id, ''), nullif(p_buyer, ''), p_sold_at, p_gross_cents,
          v_fee, coalesce(p_promotion_fee_cents, 0), coalesce(p_shipping_cost_cents, 0),
          coalesce(p_packaging_cost_cents, v_org.packaging_cost_cents), v_tax, v_org.vat_regime, p_notes, auth.uid())
  returning id into v_order;

  for i in 1..array_length(v_ids, 1) loop
    insert into order_lines(org_id, order_id, item_id, sale_price_cents, cost_snapshot_cents)
    values (v_org_id, v_order, v_ids[i], v_alloc[i], v_costs[i]);
    update listings set status = 'sold', ended_at = p_sold_at
     where item_id = v_ids[i] and status in ('active', 'reserved') and channel = p_channel;
    update listings set status = 'delisted', ended_at = now()
     where item_id = v_ids[i] and status in ('draft', 'active', 'reserved');
    perform private.transition(v_ids[i], 'sold', 'sales',
              jsonb_build_object('order_id', v_order, 'sold_at', p_sold_at));
  end loop;
  return v_order;
end $$;

-- CSV import: an empty or missing « emballage » column takes the default amount
create or replace function public.import_sales(p_sales jsonb, p_historical boolean, p_state text default 'completed')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := private.require_role('manager');
  v_batch uuid; v_supplier uuid; v_code text; v_loc uuid;
  s jsonb; l jsonb; v_i int := 0; v_ids uuid[]; v_item items; v_sku text; v_gross bigint; v_order uuid;
  v_sold timestamptz; v_ext text; v_created int := 0; v_orders int := 0; v_errors jsonb := '[]';
begin
  if p_state not in ('pending', 'shipped', 'completed') then
    raise exception using errcode = 'LF422', message = 'État de vente inconnu.';
  end if;
  if jsonb_array_length(p_sales) > 500 then
    raise exception using errcode = 'LF422', message = 'Maximum 500 ventes par envoi.';
  end if;

  -- batch for items created by this import (outside the per-sale rollback)
  if exists (
    select 1 from jsonb_array_elements(p_sales) x, jsonb_array_elements(x->'lines') y
     where not exists (select 1 from items where org_id = v_org and sku = upper(nullif(trim(y->>'sku'), '')))
  ) then
    insert into suppliers(org_id, name, notes) values (v_org, 'Stock existant', 'Articles présents avant Lefort OS')
      on conflict (org_id, lower(name)) do nothing;
    select id into v_supplier from suppliers where org_id = v_org and lower(name) = 'stock existant';
    v_code := 'LOT-HISTORIQUE-' || to_char(now() at time zone 'Europe/Paris', 'YYYYMMDD-HH24MI');
    if exists (select 1 from batches where org_id = v_org and code = v_code) then
      v_code := v_code || '-' || upper(substr(md5(random()::text), 1, 4));
    end if;
    insert into batches(org_id, code, supplier_id, purchased_at, allocation_method, kind, notes, created_by)
    values (v_org, v_code, v_supplier, current_date, 'equal', 'opening_stock', 'Articles créés par l''import des ventes', auth.uid())
    returning id into v_batch;
  end if;
  if p_state = 'pending' then
    insert into locations(org_id, code, label, kind, pick_order)
    values (v_org, 'EMP-A-ETIQUETER', 'Importé : à étiqueter et ranger', 'staging', 0)
    on conflict (org_id, code) do nothing;
    select id into v_loc from locations where org_id = v_org and code = 'EMP-A-ETIQUETER';
  end if;

  for s in select * from jsonb_array_elements(p_sales) loop
    v_i := v_i + 1;
    begin
      v_ids := '{}';
      v_gross := 0;
      v_sold := coalesce((s->>'sold_at')::timestamptz, now());
      if exists (select 1 from orders where org_id = v_org and external_order_id = nullif(s->>'order_ref', '')
                    and status <> 'cancelled') then
        raise exception using errcode = 'LF409', message = format('Commande %s déjà enregistrée.', s->>'order_ref');
      end if;
      for l in select * from jsonb_array_elements(s->'lines') loop
        if (l->>'price_cents') is null then
          raise exception using errcode = 'LF422', message = 'Prix de vente manquant.';
        end if;
        v_sku := upper(nullif(trim(l->>'sku'), ''));
        v_ext := substring(l->>'vinted_url' from 'vinted\.[a-z.]+/items/([0-9]+)');
        select * into v_item from items where org_id = v_org and sku = v_sku;
        if v_sku is null and v_ext is not null then
          -- no SKU: the Vinted link identifies an item already known (and stops a re-import duplicating it)
          select i.* into v_item from listings li join items i on i.id = li.item_id
           where li.org_id = v_org and li.channel = 'vinted' and li.external_id = v_ext
           order by li.listed_at desc limit 1;
          v_sku := v_item.sku;
        end if;
        if v_item.id is not null then
          if v_item.deleted_at is not null then
            raise exception using errcode = 'LF409', message = format('%s est dans la corbeille.', v_sku);
          end if;
          if v_item.status not in ('listing_ready', 'listed', 'reserved') then
            raise exception using errcode = 'LF409', message = format('%s n''est pas en vente (%s).', v_sku, v_item.status);
          end if;
        else
          if v_sku is null then
            select x into v_sku from public.issue_sku_labels(v_batch, 1) x;
          else
            if v_sku !~ '^[A-Z0-9-]{3,30}$' then
              raise exception using errcode = 'LF422', message = 'SKU invalide (lettres, chiffres et tirets).';
            end if;
            insert into sku_labels(sku, org_id, batch_id, issued_by) values (v_sku, v_org, v_batch, auth.uid())
              on conflict (sku) do nothing;
          end if;
          insert into items(org_id, sku, batch_id, status, category_id, brand_id, size_label, condition, title,
                            current_location_id, received_at, created_by, notes)
          values (v_org, v_sku, v_batch, 'listing_ready',
                  coalesce((select id from categories where org_id = v_org and lower(name) = lower(trim(l->>'category'))),
                           private.guess_category(v_org, coalesce(l->>'title', '') || ' ' || coalesce(l->>'category', ''))),
                  private.brand_for(v_org, l->>'brand'), nullif(trim(l->>'size'), ''),
                  (nullif(l->>'condition', ''))::item_condition, nullif(l->>'title', ''), v_loc,
                  least(v_sold, now()), auth.uid(), 'Créé par l''import des ventes')
          returning * into v_item;
          if (l->>'cost_cents') is not null then
            update item_costs set allocated_cost_cents = (l->>'cost_cents')::bigint, manual = true where item_id = v_item.id;
          end if;
          if nullif(l->>'vinted_url', '') is not null
             and (v_ext is null or not exists (select 1 from listings where org_id = v_org and channel = 'vinted' and external_id = v_ext)) then
            insert into listings(org_id, item_id, channel, external_id, url, title, price_cents, listed_at, created_by)
            values (v_org, v_item.id, 'vinted', v_ext, l->>'vinted_url', v_item.title, (l->>'price_cents')::bigint, least(v_sold, now()), auth.uid());
          end if;
          insert into item_events(org_id, item_id, type, to_status, station, actor_id, payload)
          values (v_org, v_item.id, 'imported', 'listing_ready', 'sales_import', auth.uid(), '{"source":"csv_sales"}');
          v_created := v_created + 1;
        end if;
        -- the sale is split across its items by list price: use each line's own price
        update items set list_price_cents = nullif((l->>'price_cents')::bigint, 0),
                         min_price_cents = least(min_price_cents, nullif((l->>'price_cents')::bigint, 0))
         where id = v_item.id;
        v_ids := v_ids || v_item.id;
        v_gross := v_gross + (l->>'price_cents')::bigint;
      end loop;
      if cardinality(v_ids) = 0 then
        raise exception using errcode = 'LF422', message = 'Vente sans article.';
      end if;

      v_order := public.record_sale(v_ids, v_gross, v_sold, 'vinted', nullif(s->>'order_ref', ''), nullif(s->>'buyer', ''),
                                    (s->>'platform_fee_cents')::bigint, 0, coalesce((s->>'shipping_cents')::bigint, 0),
                                    nullif(s->>'packaging_cents', '')::bigint, 'Import CSV');
      update orders set is_historical = p_historical where id = v_order;
      if p_state in ('shipped', 'completed') then
        perform public.ship_order(v_order, null, null);
        update shipments set shipped_at = v_sold where order_id = v_order;
        update items set shipped_at = v_sold where id = any(v_ids);
      end if;
      if p_state = 'completed' then
        perform public.complete_order(v_order, coalesce((s->>'paid_at')::timestamptz, v_sold));
        update items set completed_at = coalesce((s->>'paid_at')::timestamptz, v_sold) where id = any(v_ids);
      end if;
      v_orders := v_orders + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object('sale', v_i, 'error', sqlerrm);
    end;
  end loop;

  if v_batch is not null and v_created = 0 then
    delete from sku_labels where batch_id = v_batch;
    delete from batches where id = v_batch;
  end if;
  return jsonb_build_object('orders', v_orders, 'items_created', v_created, 'errors', v_errors);
end $$;

-- Vinted synchronisation: the packaging is the default amount
create or replace function private.vinted_record(p_vo uuid, p_items uuid[], p_historical boolean, p_run uuid, p_detail jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare m vinted_orders; v_order uuid; v_number bigint;
begin
  select * into m from vinted_orders where id = p_vo;
  v_order := public.record_sale(p_items, m.price_cents, least(now(), coalesce(m.sold_at, now())), 'vinted', m.transaction_id,
                                m.buyer, null, 0, 0, null, 'Synchro Vinted');
  update orders set is_historical = coalesce(p_historical, false) where id = v_order returning number into v_number;
  update vinted_orders set order_id = v_order, match = case when p_detail ? 'manual' then 'confirmed' else 'created' end,
         decision = null, decision_note = null where id = p_vo;
  perform private.vinted_event(m.org_id, p_run, 'order_imported', m.id, v_order, null, m.transaction_id, null,
    jsonb_build_object('number', v_number, 'items', (select jsonb_agg(sku order by sku) from items where id = any(p_items)),
                       'historical', coalesce(p_historical, false), 'price_cents', m.price_cents) || coalesce(p_detail, '{}'));
  perform private.vinted_follow(p_vo, p_run);
  return v_order;
end $$;

-- The default packaging amount, for the sale form (and to tell that this update is installed)
create function public.packaging_cost() returns bigint
language sql stable security definer set search_path = public as $$
  select packaging_cost_cents from organizations where id = public.auth_org_id()
$$;
revoke all on function public.packaging_cost() from public, anon;
grant execute on function public.packaging_cost() to authenticated;
