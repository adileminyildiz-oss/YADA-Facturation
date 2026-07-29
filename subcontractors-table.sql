-- =====================================================================
--  AEM-CONSEIL — Sous-traitants BTP par compte (cloud + RLS)
--  À exécuter dans Supabase (après data-migration.sql).
--  Chaque utilisateur ne voit et ne modifie QUE ses propres fiches.
-- =====================================================================

create table if not exists public.subcontractors (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.subcontractors enable row level security;
create index if not exists subcontractors_user_idx on public.subcontractors(user_id);

drop policy if exists subcontractors_own on public.subcontractors;
create policy subcontractors_own on public.subcontractors
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
