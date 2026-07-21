-- =====================================================================
--  AEM-CONSEIL — Espace d'administration des utilisateurs
--  À exécuter UNE FOIS dans Supabase : Dashboard > SQL Editor > New query
--  (copier/coller tout ce fichier, puis "Run").
--
--  Ce script crée des fonctions SÉCURISÉES (côté serveur) permettant
--  aux seuls administrateurs de lister et supprimer des comptes.
--  Aucune clé secrète n'est exposée dans le site : la page admin
--  appelle ces fonctions avec la session de l'utilisateur connecté.
-- =====================================================================

-- 1) Liste des administrateurs (par e-mail) ----------------------------
create table if not exists public.admins (
  email text primary key
);
alter table public.admins enable row level security;
-- Aucune policy => la table est invisible/inmodifiable depuis le site.
-- Gérez la liste des admins ici, dans l'éditeur SQL.

-- Admin initial (modifiez / ajoutez vos e-mails d'admin ci-dessous) :
insert into public.admins(email) values
  ('adilemin.yildiz@gmail.com'),
  ('adileminyildiz@icloud.com')
  on conflict (email) do nothing;

-- 2) L'appelant est-il administrateur ? --------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public, auth
stable
as $$
  select exists (
    select 1 from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- 3) Lister les utilisateurs (admins uniquement) -----------------------
create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : administrateur requis.';
  end if;

  return query
    select u.id,
           u.email::text,
           u.created_at,
           u.last_sign_in_at,
           u.email_confirmed_at
    from auth.users u
    order by u.last_sign_in_at desc nulls last, u.created_at desc;
end;
$$;

-- 4) Supprimer un utilisateur (admins uniquement) ----------------------
create or replace function public.admin_delete_user(target uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès refusé : administrateur requis.';
  end if;

  if target = auth.uid() then
    raise exception 'Vous ne pouvez pas supprimer votre propre compte.';
  end if;

  delete from auth.users where id = target;
end;
$$;

-- 5) Permissions -------------------------------------------------------
revoke all on function public.is_admin()            from public, anon;
revoke all on function public.admin_list_users()    from public, anon;
revoke all on function public.admin_delete_user(uuid) from public, anon;

grant execute on function public.is_admin()            to authenticated;
grant execute on function public.admin_list_users()    to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- =====================================================================
--  Pour ajouter un admin plus tard :
--    insert into public.admins(email) values ('autre@exemple.fr');
--  Pour en retirer un :
--    delete from public.admins where email = 'autre@exemple.fr';
-- =====================================================================
