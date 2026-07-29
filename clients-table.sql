-- =====================================================================
--  AEM-CONSEIL — Fiches clients par compte (cloud + RLS)
--  À exécuter dans Supabase (après data-migration.sql).
--  Chaque utilisateur ne voit et ne modifie QUE ses propres fiches.
-- =====================================================================

create table if not exists public.clients (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.clients enable row level security;
create index if not exists clients_user_idx on public.clients(user_id);

drop policy if exists clients_own on public.clients;
create policy clients_own on public.clients
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
