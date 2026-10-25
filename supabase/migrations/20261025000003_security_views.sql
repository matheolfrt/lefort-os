-- Lefort OS — permissions, storage and reporting views
-- Reads are filtered by RLS (org + role). Most writes go through RPCs (see domain migration);
-- direct writes are only granted where a plain edit is safe.

-- ───────────────────────── Grants baseline ─────────────────────────
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on schema private from public, anon, authenticated;
grant usage on schema public to authenticated;
grant execute on all functions in schema public to authenticated;
-- RPCs call private helpers as definer; RLS policies call these helpers as the user
grant usage on schema private to authenticated;
grant execute on function private.require_role(app_role[]), private.require_operator() to authenticated;

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table memberships enable row level security;
alter table suppliers enable row level security;
alter table brands enable row level security;
alter table measurement_templates enable row level security;
alter table measurement_definitions enable row level security;
alter table shot_lists enable row level security;
alter table categories enable row level security;
alter table attribute_values enable row level security;
alter table tax_rates enable row level security;
alter table locations enable row level security;
alter table batches enable row level security;
alter table batch_cost_lines enable row level security;
alter table batch_cost_adjustments enable row level security;
alter table sku_labels enable row level security;
alter table items enable row level security;
alter table item_costs enable row level security;
alter table item_photos enable row level security;
alter table item_measurements enable row level security;
alter table item_events enable row level security;
alter table item_location_moves enable row level security;
alter table price_changes enable row level security;
alter table channels enable row level security;
alter table listings enable row level security;
alter table orders enable row level security;
alter table order_lines enable row level security;
alter table refunds enable row level security;
alter table shipments enable row level security;
alter table expenses enable row level security;
alter table ai_suggestions enable row level security;
alter table scenarios enable row level security;
alter table audit_log enable row level security;

-- ───────────────────────── Everyone in the org can read ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['suppliers', 'brands', 'measurement_templates', 'shot_lists', 'categories',
    'attribute_values', 'tax_rates', 'locations', 'batches', 'sku_labels', 'items', 'item_photos',
    'item_measurements', 'item_events', 'item_location_moves', 'price_changes', 'listings',
    'shipments', 'ai_suggestions'] loop
    execute format('grant select on %I to authenticated', t);
    execute format('create policy %I on %I for select to authenticated using (org_id = public.auth_org_id())',
                   t || '_read', t);
  end loop;
end $$;

grant select on channels to authenticated;
create policy channels_read on channels for select to authenticated using (true);

grant select on organizations to authenticated;
create policy organizations_read on organizations for select to authenticated using (id = public.auth_org_id());
grant update (trade_name, legal_name, siret, address, vat_regime, declaration_frequency,
              versement_liberatoire, min_photos, dead_stock_days, vinted_fee_pct,
              vinted_fee_fixed_cents, listing_signature, sku_prefix) on organizations to authenticated;
create policy organizations_admin_update on organizations for update to authenticated
  using (id = public.auth_org_id() and public.has_role('admin'));

grant select on profiles to authenticated;
create policy profiles_read on profiles for select to authenticated
  using (id in (select user_id from memberships where org_id = public.auth_org_id()));
grant update (full_name) on profiles to authenticated;
create policy profiles_self_update on profiles for update to authenticated using (id = auth.uid());

grant select on memberships to authenticated;
create policy memberships_read on memberships for select to authenticated using (org_id = public.auth_org_id());

create policy measurement_definitions_read on measurement_definitions for select to authenticated
  using (template_id in (select id from measurement_templates where org_id = public.auth_org_id()));
grant select on measurement_definitions to authenticated;

-- ───────────────────────── Reference data: managers edit ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['suppliers', 'measurement_templates', 'shot_lists', 'categories',
                           'attribute_values', 'tax_rates', 'locations', 'batches'] loop
    execute format('grant insert, update on %I to authenticated', t);
    execute format('create policy %I on %I for insert to authenticated with check (org_id = public.auth_org_id() and public.is_manager())',
                   t || '_mgr_insert', t);
    execute format('create policy %I on %I for update to authenticated using (org_id = public.auth_org_id() and public.is_manager()) with check (org_id = public.auth_org_id())',
                   t || '_mgr_update', t);
  end loop;
end $$;
revoke update (status, closed_at, closed_by, org_id) on batches from authenticated;

grant insert, update, delete on measurement_definitions to authenticated;
create policy measurement_definitions_mgr on measurement_definitions for all to authenticated
  using (public.is_manager() and template_id in (select id from measurement_templates where org_id = public.auth_org_id()))
  with check (public.is_manager() and template_id in (select id from measurement_templates where org_id = public.auth_org_id()));

-- Anyone may add a brand while sorting (new brands appear constantly)
grant insert on brands to authenticated;
create policy brands_insert on brands for insert to authenticated with check (org_id = public.auth_org_id());
grant update on brands to authenticated;
create policy brands_mgr_update on brands for update to authenticated
  using (org_id = public.auth_org_id() and public.is_manager());

-- ───────────────────────── Items: attribute edits only ─────────────────────────
-- Status, location, version, claims and milestones are changed by RPCs only.
grant update (category_id, brand_id, gender, size_label, trouser_size_label, color_id, secondary_color_id,
              pattern_id, material_id, composition, condition, defects, notes, title, description,
              list_price_cents, min_price_cents) on items to authenticated;
create policy items_update on items for update to authenticated
  using (org_id = public.auth_org_id() and private.require_operator() is not null
         and (status not in ('sold', 'shipped', 'completed') or public.is_manager()))
  with check (org_id = public.auth_org_id());

grant insert, update, delete on item_photos to authenticated;
create policy item_photos_insert on item_photos for insert to authenticated
  with check (org_id = public.auth_org_id() and item_id in (select id from items where org_id = public.auth_org_id()));
create policy item_photos_update on item_photos for update to authenticated using (org_id = public.auth_org_id());
create policy item_photos_delete on item_photos for delete to authenticated
  using (org_id = public.auth_org_id()
         and item_id in (select id from items where status not in ('sold', 'shipped', 'completed')));

grant insert, update, delete on item_measurements to authenticated;
create policy item_measurements_write on item_measurements for all to authenticated
  using (org_id = public.auth_org_id())
  with check (org_id = public.auth_org_id() and item_id in (select id from items where org_id = public.auth_org_id()));

grant insert, update on ai_suggestions to authenticated;
create policy ai_suggestions_write on ai_suggestions for all to authenticated
  using (org_id = public.auth_org_id()) with check (org_id = public.auth_org_id());

-- ───────────────────────── Money: managers only ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['item_costs', 'batch_cost_lines', 'batch_cost_adjustments', 'orders',
                           'order_lines', 'refunds', 'expenses', 'scenarios', 'audit_log'] loop
    execute format('grant select on %I to authenticated', t);
    execute format('create policy %I on %I for select to authenticated using (org_id = public.auth_org_id() and public.is_manager())',
                   t || '_mgr_read', t);
  end loop;
  foreach t in array array['batch_cost_lines', 'batch_cost_adjustments', 'expenses', 'scenarios'] loop
    execute format('grant insert on %I to authenticated', t);
    execute format('create policy %I on %I for insert to authenticated with check (org_id = public.auth_org_id() and public.is_manager())',
                   t || '_mgr_insert', t);
  end loop;
  foreach t in array array['batch_cost_lines', 'expenses', 'scenarios'] loop
    execute format('grant update, delete on %I to authenticated', t);
    execute format('create policy %I on %I for update to authenticated using (org_id = public.auth_org_id() and public.is_manager())',
                   t || '_mgr_update', t);
    execute format('create policy %I on %I for delete to authenticated using (org_id = public.auth_org_id() and public.is_manager())',
                   t || '_mgr_delete', t);
  end loop;
end $$;

-- Fees / shipping / notes on an order may be corrected before completion (audited, guarded by trigger)
grant update (platform_fee_cents, promotion_fee_cents, shipping_cost_cents, packaging_cost_cents,
              buyer_handle, external_order_id, notes, paid_at) on orders to authenticated;
create policy orders_mgr_update on orders for update to authenticated
  using (org_id = public.auth_org_id() and public.is_manager());

-- ───────────────────────── Storage ─────────────────────────
insert into storage.buckets(id, name, public) values ('item-photos', 'item-photos', false)
  on conflict (id) do nothing;
insert into storage.buckets(id, name, public) values ('documents', 'documents', false)
  on conflict (id) do nothing;

-- Objects are stored under {org_id}/...
create policy item_photos_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'item-photos' and (storage.foldername(name))[1] = public.auth_org_id()::text);
create policy item_photos_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'item-photos' and (storage.foldername(name))[1] = public.auth_org_id()::text);
create policy item_photos_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'item-photos' and (storage.foldername(name))[1] = public.auth_org_id()::text);
create policy documents_objects_all on storage.objects for all to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = public.auth_org_id()::text and public.is_manager())
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = public.auth_org_id()::text and public.is_manager());

-- ───────────────────────── Reporting views ─────────────────────────
-- All views are security_invoker: the caller's RLS applies (money views return nothing to operators).

-- Pipeline: counts only, visible to everyone
create view v_pipeline with (security_invoker = true) as
select status, count(*)::int as items, min(status_changed_at) as oldest_since
  from items where deleted_at is null and org_id = public.auth_org_id()
 group by status;

create view v_batch_progress with (security_invoker = true) as
select b.id as batch_id, b.code, b.status, s.name as supplier_name, b.purchased_at, b.received_at, b.expected_qty,
       (select count(*) from sku_labels l where l.batch_id = b.id)::int as labels_issued,
       count(i.id)::int as items,
       count(i.id) filter (where i.status not in ('received'))::int as sorted,
       count(i.id) filter (where i.photo_count > 0)::int as photographed,
       count(i.id) filter (where i.listed_at is not null)::int as listed,
       count(i.id) filter (where i.status in ('sold', 'shipped', 'completed'))::int as sold,
       count(i.id) filter (where i.status = 'rejected')::int as rejected
  from batches b
  join suppliers s on s.id = b.supplier_id
  left join items i on i.batch_id = b.id and i.deleted_at is null
 group by b.id, s.name;

-- One canonical economics row per item. Every money aggregate derives from this.
create view v_item_economics with (security_invoker = true) as
with lines as (
  select ol.item_id,
         sum(ol.sale_price_cents) as revenue_gross_cents,
         sum(coalesce(r.refunded, 0)) as refunded_cents,
         sum(case when o.gross_cents > 0 then
               round((o.platform_fee_cents + o.promotion_fee_cents + o.shipping_cost_cents + o.packaging_cost_cents)
                     * ol.sale_price_cents::numeric / o.gross_cents)
             else 0 end)::bigint as variable_costs_cents,
         sum(case when o.gross_cents > 0 then round(o.tax_cents * ol.sale_price_cents::numeric / o.gross_cents) else 0 end)::bigint as vat_cents,
         max(o.sold_at) as last_sold_at,
         max(o.paid_at) as last_paid_at,
         bool_or(ol.status = 'active') as has_active_sale,
         -- cost is snapshotted at sale; use the most recent sale's snapshot
         (array_agg(ol.cost_snapshot_cents order by o.sold_at desc))[1] as cost_snapshot_cents
    from order_lines ol
    join orders o on o.id = ol.order_id and o.status <> 'cancelled'
    left join lateral (select sum(amount_cents) as refunded from refunds where order_line_id = ol.id) r on true
   where ol.status <> 'cancelled'
   group by ol.item_id
)
select i.id as item_id, i.org_id, i.sku, i.status, i.batch_id, b.supplier_id, i.brand_id, i.category_id,
       i.received_at, i.listed_at, i.sold_at,
       coalesce(l.cost_snapshot_cents, ic.allocated_cost_cents, 0) as cost_cents,
       coalesce(l.revenue_gross_cents, 0) - coalesce(l.refunded_cents, 0) as revenue_cents,
       coalesce(l.variable_costs_cents, 0) as variable_costs_cents,
       coalesce(l.vat_cents, 0) as vat_cents,
       coalesce(l.revenue_gross_cents, 0) - coalesce(l.refunded_cents, 0)
         - coalesce(l.variable_costs_cents, 0) - coalesce(l.vat_cents, 0)
         - case when l.item_id is not null then coalesce(l.cost_snapshot_cents, ic.allocated_cost_cents, 0) else 0 end
         as gross_profit_cents,
       l.item_id is not null and l.has_active_sale as is_sold,
       extract(epoch from (i.sold_at - i.listed_at)) / 86400 as days_to_sell,
       extract(epoch from (coalesce(i.sold_at, now()) - i.received_at)) / 86400 as age_days
  from items i
  join batches b on b.id = i.batch_id
  join item_costs ic on ic.item_id = i.id
  left join lines l on l.item_id = i.id
 where i.deleted_at is null;

create view v_batch_economics with (security_invoker = true) as
select b.id as batch_id, b.code, b.status, b.supplier_id, s.name as supplier_name, b.purchased_at,
       (select coalesce(sum(amount_cents), 0) from batch_cost_lines where batch_id = b.id)
       + (select coalesce(sum(amount_cents), 0) from batch_cost_adjustments where batch_id = b.id) as total_cost_cents,
       count(e.item_id)::int as items,
       count(e.item_id) filter (where e.is_sold)::int as items_sold,
       coalesce(sum(e.revenue_cents), 0)::bigint as revenue_cents,
       coalesce(sum(e.variable_costs_cents + e.vat_cents), 0)::bigint as variable_costs_cents,
       round(avg(e.days_to_sell) filter (where e.is_sold), 1) as avg_days_to_sell
  from batches b
  join suppliers s on s.id = b.supplier_id
  left join v_item_economics e on e.batch_id = b.id
 group by b.id, s.name;

-- Realised profit counts the whole batch cost (unsold stock is still money spent)
create view v_batch_profitability with (security_invoker = true) as
select *,
       revenue_cents - variable_costs_cents - total_cost_cents as profit_cents,
       case when total_cost_cents > 0
            then round((revenue_cents - variable_costs_cents - total_cost_cents) * 100.0 / total_cost_cents, 1) end as roi_pct,
       case when items > 0 then round(items_sold * 100.0 / items, 1) end as sell_through_pct
  from v_batch_economics;

create view v_supplier_profitability with (security_invoker = true) as
select supplier_id, supplier_name,
       count(*)::int as batches, sum(items)::int as items, sum(items_sold)::int as items_sold,
       sum(total_cost_cents)::bigint as total_cost_cents, sum(revenue_cents)::bigint as revenue_cents,
       sum(revenue_cents - variable_costs_cents - total_cost_cents)::bigint as profit_cents,
       case when sum(total_cost_cents) > 0
            then round(sum(revenue_cents - variable_costs_cents - total_cost_cents) * 100.0 / sum(total_cost_cents), 1) end as roi_pct,
       case when sum(items) > 0 then round(sum(items_sold) * 100.0 / sum(items), 1) end as sell_through_pct
  from v_batch_economics
 group by supplier_id, supplier_name;

-- Sold items only: per-item margin by brand / category
create view v_brand_profitability with (security_invoker = true) as
select br.id as brand_id, br.name as brand_name, br.tier,
       count(*)::int as items_sold, sum(e.revenue_cents)::bigint as revenue_cents,
       sum(e.gross_profit_cents)::bigint as profit_cents,
       round(avg(e.revenue_cents)) as avg_price_cents, round(avg(e.days_to_sell), 1) as avg_days_to_sell
  from v_item_economics e join brands br on br.id = e.brand_id
 where e.is_sold
 group by br.id;

create view v_category_profitability with (security_invoker = true) as
select c.id as category_id, c.name as category_name,
       count(*)::int as items_sold, sum(e.revenue_cents)::bigint as revenue_cents,
       sum(e.gross_profit_cents)::bigint as profit_cents,
       round(avg(e.revenue_cents)) as avg_price_cents, round(avg(e.days_to_sell), 1) as avg_days_to_sell
  from v_item_economics e join categories c on c.id = e.category_id
 where e.is_sold
 group by c.id;

-- ───────────────────────── Compliance (micro-entreprise) ─────────────────────────
-- Livre des recettes: receipts at the date money is received; refunds as negative entries
create view v_livre_recettes with (security_invoker = true) as
select o.org_id, (o.paid_at at time zone 'Europe/Paris')::date as date_encaissement, 'V-' || o.number as reference,
       o.channel, o.buyer_handle as client,
       (select string_agg(i.sku, ', ' order by i.sku) from order_lines ol join items i on i.id = ol.item_id
         where ol.order_id = o.id and ol.status <> 'cancelled') as nature,
       o.gross_cents as montant_cents, o.payment_method as mode_reglement
  from orders o
 where o.paid_at is not null and o.status <> 'cancelled'
union all
select r.org_id, (r.refunded_at at time zone 'Europe/Paris')::date, 'R-' || o.number, o.channel, o.buyer_handle,
       'Remboursement : ' || r.reason, -r.amount_cents, o.payment_method
  from refunds r join orders o on o.id = r.order_id
 where o.paid_at is not null;

-- Registre des achats: one line per purchase (goods + costs) and per expense
create view v_registre_achats with (security_invoker = true) as
select b.org_id, b.purchased_at as date_achat, s.name as fournisseur, b.invoice_number as reference_facture,
       'Lot ' || b.code as nature,
       (select coalesce(sum(amount_cents), 0) from batch_cost_lines where batch_id = b.id) as montant_cents,
       b.payment_method as mode_reglement
  from batches b join suppliers s on s.id = b.supplier_id
union all
select a.org_id, (a.created_at at time zone 'Europe/Paris')::date, s.name, null, 'Ajustement lot ' || b.code || ' : ' || a.reason, a.amount_cents, null
  from batch_cost_adjustments a join batches b on b.id = a.batch_id join suppliers s on s.id = b.supplier_id
union all
select e.org_id, e.spent_on, e.supplier, e.invoice_number, 'Frais : ' || e.category, e.amount_cents, e.payment_method
  from expenses e;

-- Monthly turnover (chiffre d'affaires encaissé) and estimated URSSAF contributions
create view v_monthly_turnover with (security_invoker = true) as
with m as (
  select org_id, date_trunc('month', date_encaissement)::date as month, sum(montant_cents)::bigint as turnover_cents
    from v_livre_recettes group by 1, 2
)
select m.org_id, m.month, m.turnover_cents,
       round(m.turnover_cents * (
         coalesce((select rate_pct from tax_rates t where t.org_id = m.org_id and t.kind = 'urssaf_bic_vente'
                    and t.valid_from <= m.month order by valid_from desc limit 1), 0)
       + coalesce((select rate_pct from tax_rates t where t.org_id = m.org_id and t.kind = 'cfp'
                    and t.valid_from <= m.month order by valid_from desc limit 1), 0)
       + case when o.versement_liberatoire then
           coalesce((select rate_pct from tax_rates t where t.org_id = m.org_id and t.kind = 'versement_liberatoire'
                      and t.valid_from <= m.month order by valid_from desc limit 1), 0) else 0 end
       ) / 100)::bigint as contributions_cents
  from m join organizations o on o.id = m.org_id;

grant select on v_pipeline, v_batch_progress, v_item_economics, v_batch_economics, v_batch_profitability,
  v_supplier_profitability, v_brand_profitability, v_category_profitability,
  v_livre_recettes, v_registre_achats, v_monthly_turnover to authenticated;
