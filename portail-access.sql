-- =====================================================================
--  AEM-CONSEIL — Portail destinataires (accès en lecture seule)
--  À exécuter dans Supabase (après data-migration.sql).
--
--  Permet à un utilisateur authentifié (le destinataire) de LIRE
--  uniquement les factures ÉMISES qui lui sont adressées, c.-à-d. dont
--  l'e-mail client correspond à l'e-mail de son compte. Aucune écriture :
--  le destinataire ne peut ni créer, ni modifier, ni supprimer.
--
--  Cette policy s'ajoute (mode permissif = OU) à la policy propriétaire
--  « invoices_own » ; elle n'ouvre donc qu'un accès SELECT restreint.
-- =====================================================================

drop policy if exists invoices_recipient_read on public.invoices;
create policy invoices_recipient_read on public.invoices
  for select
  to authenticated
  using (
    coalesce((data->>'emitted')::boolean, false) = true
    and lower(coalesce(data->'client'->>'email','')) = lower(coalesce(auth.jwt()->>'email',''))
    and lower(coalesce(auth.jwt()->>'email','')) <> ''
  );
