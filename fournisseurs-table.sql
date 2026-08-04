-- =====================================================================
--  AEM-CONSEIL — Fiches fournisseurs par compte (cloud + RLS)
--  À exécuter dans Supabase (après data-migration.sql).
--  Chaque utilisateur ne voit et ne modifie QUE ses propres fiches.
-- =====================================================================

create table if not exists public.fournisseurs (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.fournisseurs enable row level security;
create index if not exists fournisseurs_user_idx on public.fournisseurs(user_id);

drop policy if exists fournisseurs_own on public.fournisseurs;
create policy fournisseurs_own on public.fournisseurs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
