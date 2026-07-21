-- =====================================================================
--  AEM-CONSEIL — Contrôle d'accès : validation manuelle des comptes
--  À exécuter dans Supabase APRÈS admin-users.sql (il réutilise is_admin).
--  SQL Editor > New query > coller > Run.
--
--  Effet : toute nouvelle inscription crée un compte NON approuvé.
--  L'utilisateur ne peut entrer dans l'espace qu'une fois approuvé par
--  un administrateur (les comptes déjà existants restent autorisés).
-- =====================================================================

-- 1) Profils (statut d'approbation par compte) -------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());
-- (aucune policy d'écriture => modifiable seulement via les fonctions ci-dessous)

-- 2) Création automatique du profil à l'inscription -------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  insert into public.profiles(id, email, approved)
    values (new.id, new.email, false)
    on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) Ne pas verrouiller les comptes déjà créés ------------------------
insert into public.profiles(id, email, approved)
  select id, email, true from auth.users
  on conflict (id) do nothing;

-- Les administrateurs sont toujours approuvés
update public.profiles p set approved = true
  from public.admins a where lower(a.email) = lower(p.email);

-- 4) Le compte courant est-il approuvé (ou admin) ? -------------------
create or replace function public.is_approved()
returns boolean language sql security definer set search_path = public, auth stable as $$
  select public.is_admin() or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.approved = true
  );
$$;

-- 5) Admin : liste des comptes (avec statut d'approbation) ------------
drop function if exists public.admin_list_users();
create or replace function public.admin_list_users()
returns table (
  id uuid, email text, created_at timestamptz,
  last_sign_in_at timestamptz, email_confirmed_at timestamptz, approved boolean
)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Accès refusé : administrateur requis.'; end if;
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at, u.email_confirmed_at,
           coalesce(p.approved, false)
    from auth.users u
    left join public.profiles p on p.id = u.id
    order by coalesce(p.approved, false) asc, u.last_sign_in_at desc nulls last, u.created_at desc;
end; $$;

-- 6) Admin : approuver / suspendre un compte --------------------------
create or replace function public.admin_set_approved(target uuid, val boolean)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Accès refusé : administrateur requis.'; end if;
  insert into public.profiles(id, email, approved)
    select u.id, u.email, val from auth.users u where u.id = target
    on conflict (id) do update set approved = excluded.approved;
end; $$;

-- 7) Permissions ------------------------------------------------------
revoke all on function public.is_approved()                  from public, anon;
revoke all on function public.admin_set_approved(uuid,boolean) from public, anon;
grant execute on function public.is_approved()               to authenticated;
grant execute on function public.admin_list_users()          to authenticated;
grant execute on function public.admin_set_approved(uuid,boolean) to authenticated;
