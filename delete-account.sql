-- =====================================================================
--  AEM-CONSEIL — Suppression de compte par l'utilisateur (RGPD)
--  À exécuter dans Supabase après les tables de données.
--
--  Permet à un utilisateur connecté de supprimer LUI-MÊME son compte.
--  La suppression de auth.users cascade sur toutes ses données
--  (invoices, user_settings, clients, subcontractors, invoice_acks,
--  profiles — toutes rattachées par une clé étrangère ON DELETE CASCADE).
-- =====================================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Non authentifié.'; end if;
  delete from auth.users where id = uid;   -- cascade sur toutes les données du compte
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
