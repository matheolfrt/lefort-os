-- Lefort OS — import of sales, including items that were never in the Lefort OS stock
-- Historical sales (already declared elsewhere) count for statistics but stay out of the livre des recettes
-- and the URSSAF turnover, so nothing is declared twice.

alter table orders add column is_historical boolean not null default false;

create or replace view v_livre_recettes with (security_invoker = true) as
select o.org_id, (o.paid_at at time zone 'Europe/Paris')::date as date_encaissement, 'V-' || o.number as reference,
       o.channel, o.buyer_handle as client,
       (select string_agg(i.sku, ', ' order by i.sku) from order_lines ol join items i on i.id = ol.item_id
         where ol.order_id = o.id and ol.status <> 'cancelled') as nature,
       o.gross_cents as montant_cents, o.payment_method as mode_reglement
  from orders o
 where o.paid_at is not null and o.status <> 'cancelled' and not o.is_historical
union all
select r.org_id, (r.refunded_at at time zone 'Europe/Paris')::date, 'R-' || o.number, o.channel, o.buyer_handle,
       'Remboursement : ' || r.reason, -r.amount_cents, o.payment_method
  from refunds r join orders o on o.id = r.order_id
 where o.paid_at is not null and not o.is_historical;

-- p_sales: [{ sold_at, paid_at, buyer, order_ref, shipping_cents, packaging_cents, platform_fee_cents,
--             lines: [{ sku, title, brand, size, category, condition, price_cents, cost_cents, vinted_url }] }]
-- p_state: 'pending' (à expédier) | 'shipped' | 'completed' (expédiée et encaissée)
-- Lines whose SKU is unknown (or empty) create the item in a "historique" batch first. Their listing date is
-- unknown, so they stay out of the time-to-sell statistics.
create function public.import_sales(p_sales jsonb, p_historical boolean, p_state text default 'completed')
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
                                    coalesce((s->>'packaging_cents')::bigint, 0), 'Import CSV');
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

revoke all on function public.import_sales(jsonb, boolean, text) from public, anon;
grant execute on function public.import_sales(jsonb, boolean, text) to authenticated;
