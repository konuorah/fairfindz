
-- ============================================================
-- FairFindz - Initial schema (products + user data)
-- Categories are unrestricted (text) to match spreadsheet.
-- ============================================================

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text not null,
  category text not null,
  price numeric(10,2),
  rating numeric(3,2),
  review_count integer,
  image_url text,
  product_url text not null,
  description text,
  badges text[] not null default '{}'::text[],
  amazon_keywords text[] not null default '{}'::text[],
  amazon_categories text[] not null default '{}'::text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_rating_check check (rating is null or (rating >= 1 and rating <= 5)),
  constraint products_review_count_check check (review_count is null or review_count >= 0),
  constraint products_price_check check (price is null or price >= 0)
);

drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create table if not exists public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  preferred_categories text[] not null default '{}'::text[],
  price_range_min numeric(10,2),
  price_range_max numeric(10,2),
  show_modal_automatically boolean not null default true,
  notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_preferences_one_row_per_user unique (user_id),
  constraint user_preferences_price_range_check check (
    price_range_min is null
    or price_range_max is null
    or price_range_min <= price_range_max
  )
);

drop trigger if exists set_user_preferences_updated_at on public.user_preferences;
create trigger set_user_preferences_updated_at
before update on public.user_preferences
for each row execute function public.set_updated_at();

create table if not exists public.user_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  action_type text not null,
  amazon_product_url text,
  created_at timestamptz not null default now(),
  constraint user_history_action_type_check
    check (action_type in ('viewed', 'clicked', 'favorited'))
);

create table if not exists public.user_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_favorites_unique_per_user unique (user_id, product_id)
);

create index if not exists idx_products_category on public.products(category);
create index if not exists idx_products_is_active on public.products(is_active);
create index if not exists idx_products_category_active on public.products(category, is_active);
create index if not exists idx_user_history_user_id on public.user_history(user_id);
create index if not exists idx_user_history_user_id_created_at on public.user_history(user_id, created_at desc);
create index if not exists idx_user_history_created_at on public.user_history(created_at desc);
create index if not exists idx_user_favorites_user_id on public.user_favorites(user_id);
create index if not exists idx_user_preferences_user_id on public.user_preferences(user_id);

alter table public.products enable row level security;
alter table public.user_preferences enable row level security;
alter table public.user_history enable row level security;
alter table public.user_favorites enable row level security;

drop policy if exists "Products are publicly readable" on public.products;
create policy "Products are publicly readable"
on public.products
for select
to public
using (is_active = true);

drop policy if exists "Products insert denied to clients" on public.products;
create policy "Products insert denied to clients"
on public.products
for insert
to anon, authenticated
with check (false);

drop policy if exists "Products update denied to clients" on public.products;
create policy "Products update denied to clients"
on public.products
for update
to anon, authenticated
using (false);

drop policy if exists "Products delete denied to clients" on public.products;
create policy "Products delete denied to clients"
on public.products
for delete
to anon, authenticated
using (false);

drop policy if exists "Users can read own preferences" on public.user_preferences;
create policy "Users can read own preferences"
on public.user_preferences
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own preferences" on public.user_preferences;
create policy "Users can insert own preferences"
on public.user_preferences
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own preferences" on public.user_preferences;
create policy "Users can update own preferences"
on public.user_preferences
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own preferences" on public.user_preferences;
create policy "Users can delete own preferences"
on public.user_preferences
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read own history" on public.user_history;
create policy "Users can read own history"
on public.user_history
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own history" on public.user_history;
create policy "Users can insert own history"
on public.user_history
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own history" on public.user_history;
create policy "Users can update own history"
on public.user_history
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own history" on public.user_history;
create policy "Users can delete own history"
on public.user_history
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read own favorites" on public.user_favorites;
create policy "Users can read own favorites"
on public.user_favorites
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own favorites" on public.user_favorites;
create policy "Users can insert own favorites"
on public.user_favorites
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own favorites" on public.user_favorites;
create policy "Users can delete own favorites"
on public.user_favorites
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users cannot update favorites" on public.user_favorites;
create policy "Users cannot update favorites"
on public.user_favorites
for update
to authenticated
using (false);

