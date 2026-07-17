-- ============================================================
-- DealAmigo — Supabase schema + row-level security
-- Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to re-run (uses "if not exists" / "or replace").
-- ============================================================

-- ---------- tables ----------

-- One row per authenticated user, holding their role.
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'buyer' check (role in ('buyer','owner')),
  full_name  text,
  created_at timestamptz default now()
);

-- A shop, owned by one user.
create table if not exists businesses (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references profiles(id) on delete cascade,
  slug                 text unique not null,
  name                 text not null,
  tagline              text,
  address              text,
  phone                text,
  whatsapp             text,
  category             text,
  max_discount_pct     numeric default 15,
  small_order_min      int     default 5,
  big_order_threshold  numeric default 15000,
  created_at           timestamptz default now()
);

-- Products belong to a shop. This is the agent's entire inventory.
create table if not exists products (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  name             text not null,
  unit             text    default 'piece',
  list_price       numeric not null,
  max_discount_pct numeric default 0,
  moq              int     default 1,
  stock            int     default 0,
  pitch            text,
  created_at       timestamptz default now()
);

-- Closed deals, for the owner's history + analytics.
create table if not exists deals (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  product     text,
  quantity    int,
  unit_price  numeric,
  total       numeric,
  transcript  jsonb,
  status      text default 'closed',
  created_at  timestamptz default now()
);

-- ---------- auto-create a profile when a user signs up ----------
-- Reads the role passed in signUp metadata (defaults to 'buyer').
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'buyer'),
    new.raw_user_meta_data->>'full_name'
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- row-level security ----------
alter table profiles   enable row level security;
alter table businesses enable row level security;
alter table products   enable row level security;
alter table deals      enable row level security;

-- profiles: a user can only see and edit their own row
drop policy if exists "own profile read"   on profiles;
drop policy if exists "own profile insert" on profiles;
drop policy if exists "own profile update" on profiles;
create policy "own profile read"   on profiles for select using (auth.uid() = id);
create policy "own profile insert" on profiles for insert with check (auth.uid() = id);
create policy "own profile update" on profiles for update using (auth.uid() = id);

-- businesses: anyone may read (buyers browse); only the owner may write
drop policy if exists "businesses public read" on businesses;
drop policy if exists "owner write business"   on businesses;
create policy "businesses public read" on businesses for select using (true);
create policy "owner write business"   on businesses for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- products: anyone may read; only the business owner may write
drop policy if exists "products public read" on products;
drop policy if exists "owner write products" on products;
create policy "products public read" on products for select using (true);
create policy "owner write products" on products for all
  using      (exists (select 1 from businesses b where b.id = products.business_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from businesses b where b.id = products.business_id and b.owner_id = auth.uid()));

-- deals: only the owner reads their shop's deals; inserts allowed (chat closes them)
drop policy if exists "owner read deals" on deals;
drop policy if exists "insert deals"     on deals;
create policy "owner read deals" on deals for select
  using (exists (select 1 from businesses b where b.id = deals.business_id and b.owner_id = auth.uid()));
create policy "insert deals" on deals for insert with check (true);
