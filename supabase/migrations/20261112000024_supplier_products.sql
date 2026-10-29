-- Lefort OS — products spotted at a supplier: a link to a product page and its reference, to find it again and buy it
-- again (price seen, a note). Managers only, like the rest of the supplier pages.

create table supplier_products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.auth_org_id() references organizations(id),
  supplier_id uuid not null references suppliers(id) on delete cascade,
  url text not null check (url ~* '^https?://[^\s]+$' and length(url) <= 2000),
  reference text check (reference is null or length(trim(reference)) between 1 and 200),
  price_cents bigint check (price_cents is null or price_cents >= 0),
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid()
);
create index supplier_products_supplier_idx on supplier_products(supplier_id, created_at desc);

alter table supplier_products enable row level security;
grant select, insert, update, delete on supplier_products to authenticated;
create policy supplier_products_mgr on supplier_products for all to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_manager()))
  with check (org_id = (select public.auth_org_id()) and (select public.is_manager())
              and exists (select 1 from suppliers s where s.id = supplier_id and s.org_id = (select public.auth_org_id())));

-- detects that this update is installed (the app shows the section only then)
create function public.supplier_products_ready() returns boolean language sql stable as $$ select true $$;
revoke all on function public.supplier_products_ready() from public, anon;
grant execute on function public.supplier_products_ready() to authenticated;
