-- =====================================================================
--  AEM-CONSEIL — Accusés destinataire (consultation / réception)
--  À exécuter dans Supabase (après data-migration.sql + portail-access.sql).
--
--  Le destinataire (portail) enregistre un accusé horodaté ; l'émetteur
--  (propriétaire de la facture) le consulte. Personne ne peut modifier
--  ni supprimer un accusé — il fait foi de la date de consultation /
--  réception.
-- =====================================================================

create table if not exists public.invoice_acks (
  id bigint generated always as identity primary key,
  invoice_id text not null,
  recipient_email text not null,
  kind text not null default 'received',        -- 'viewed' | 'received'
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  at timestamptz not null default now()
);
alter table public.invoice_acks enable row level security;
create index if not exists invoice_acks_invoice_idx on public.invoice_acks(invoice_id);

-- Destinataire : insère ses propres accusés (e-mail = e-mail du compte)
drop policy if exists acks_recipient_ins on public.invoice_acks;
create policy acks_recipient_ins on public.invoice_acks
  for insert to authenticated
  with check (lower(recipient_email) = lower(coalesce(auth.jwt()->>'email','')));

-- Destinataire : lit ses propres accusés
drop policy if exists acks_recipient_sel on public.invoice_acks;
create policy acks_recipient_sel on public.invoice_acks
  for select to authenticated
  using (lower(recipient_email) = lower(coalesce(auth.jwt()->>'email','')));

-- Émetteur : lit les accusés des factures qu'il possède
drop policy if exists acks_owner_sel on public.invoice_acks;
create policy acks_owner_sel on public.invoice_acks
  for select to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_acks.invoice_id and i.user_id = auth.uid()
  ));
