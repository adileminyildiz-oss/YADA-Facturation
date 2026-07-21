-- =====================================================================
--  AEM-CONSEIL — Stockage des factures par compte (cloud + RLS)
--  À exécuter dans Supabase (après les autres scripts).
--  Chaque utilisateur ne voit et ne modifie QUE ses propres données.
-- =====================================================================

-- 1) Factures / devis rattachés au compte -----------------------------
create table if not exists public.invoices (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.invoices enable row level security;
create index if not exists invoices_user_idx on public.invoices(user_id);

drop policy if exists invoices_own on public.invoices;
create policy invoices_own on public.invoices
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 2) Réglages par compte (émetteur + compteurs de numérotation) --------
create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  emit jsonb,
  seq jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;

drop policy if exists settings_own on public.user_settings;
create policy settings_own on public.user_settings
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
