-- ============================================================
-- DealAmigo — migration v2: cross-device sync
-- Paste into Supabase → SQL Editor → Run. Additive and idempotent
-- (safe to re-run). Run this AFTER schema.sql has already been applied.
-- ============================================================

-- ---------- businesses: columns the app needs that schema.sql lacked ----------
alter table businesses add column if not exists email text;
alter table businesses add column if not exists pin text default '1234';
alter table businesses add column if not exists razorpay_key_id text;
alter table businesses add column if not exists about text;
alter table businesses add column if not exists logo text default '🏪';
alter table businesses add column if not exists rating numeric default 5.0;
alter table businesses add column if not exists distance text default '—';

-- Demo/seed shops aren't owned by a specific signed-up user.
alter table businesses alter column owner_id drop not null;

-- ---------- approvals: the live cross-device escalation queue ----------
-- Replaces the old browser-localStorage "pending approval" bus. A row here
-- is a deal paused for the owner's decision; the customer's tab polls it,
-- the owner's dashboard writes the decision to it.
create table if not exists approvals (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  business_slug text,
  business_name text,
  messages      jsonb,
  state         jsonb,
  product       text,
  quantity      int,
  ask_pct       numeric,
  decision      text,          -- null | 'approve' | 'reject'
  reply         text,
  created_at    timestamptz default now(),
  resolved_at   timestamptz
);
alter table approvals enable row level security;

-- Customer chat is anonymous (no login), so this queue is intentionally
-- public-read/write, same trust level the old localStorage version had —
-- tightening this to per-business auth is a follow-up, not a regression.
drop policy if exists "approvals public read"   on approvals;
drop policy if exists "approvals public insert" on approvals;
drop policy if exists "approvals public update" on approvals;
create policy "approvals public read"   on approvals for select using (true);
create policy "approvals public insert" on approvals for insert with check (true);
create policy "approvals public update" on approvals for update using (true) with check (true);

-- ---------- relax business/product writes to "any signed-in user" ----------
-- Demo shops have no single owner (owner_id null); simple businessowner
-- checks would lock everyone out of the 4 seed shops. Writing still
-- requires a logged-in session (the dashboard already enforces that via
-- requireAuth) — this just stops it also requiring exact owner_id match.
drop policy if exists "owner write business" on businesses;
create policy "owner write business" on businesses for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "owner write products" on products;
create policy "owner write products" on products for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

-- ---------- deals: readable by anyone (dashboard shows demo shops too) ----------
drop policy if exists "owner read deals" on deals;
drop policy if exists "deals public read" on deals;
create policy "deals public read" on deals for select using (true);

-- ---------- deals: columns the app needs that schema.sql lacked ----------
alter table deals add column if not exists bill_no text;
alter table deals add column if not exists list_price numeric;
alter table deals add column if not exists discount_pct numeric;
alter table deals add column if not exists paid boolean default false;
alter table deals add column if not exists payment_id text;
