-- Lefort OS — annonces: which AI writes them (quality or economical), and when a listing marked « prête » was copied
-- into its stock article (title, description, price, measurements).

alter table listing_templates add column ai_model text not null default 'qualite' check (ai_model in ('qualite', 'economique'));
grant update (ai_model) on listing_templates to authenticated;

alter table listing_drafts add column stock_applied_at timestamptz;
grant update (stock_applied_at) on listing_drafts to authenticated;

-- detects that this update is installed
create function public.listing_stock_ready() returns boolean language sql stable as $$ select true $$;
revoke all on function public.listing_stock_ready() from public, anon;
grant execute on function public.listing_stock_ready() to authenticated;
