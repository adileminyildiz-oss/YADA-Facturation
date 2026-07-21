-- =====================================================================
--  AEM-CONSEIL — Admin : visites, gestion des admins, niveaux d'accès
--  À exécuter APRÈS admin-users.sql et security-access.sql.
--  SQL Editor > New query > coller > Run.
--
--  Niveaux d'accès : 'free' = module Facturation uniquement ;
--  'pro' = tous les modules. Les administrateurs ont tout, sans condition.
-- =====================================================================

-- 0) Niveau d'accès par compte ----------------------------------------
alter table public.profiles add column if not exists plan text not null default 'free';

-- Accès du compte courant (pour l'espace) : admin / approuvé / offre
create or replace function public.my_access()
returns json language sql security definer set search_path = public, auth stable as $$
  select json_build_object(
    'admin',    public.is_admin(),
    'approved', public.is_approved(),
    'plan',     coalesce((select plan from public.profiles where id = auth.uid()), 'free')
  );
$$;
revoke all on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;

-- Admin : définir l'offre d'un compte ('free' ou 'pro')
create or replace function public.admin_set_plan(target uuid, new_plan text)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Accès refusé : administrateur requis.'; end if;
  if new_plan not in ('free','essentiel','pro','premium') then raise exception 'Offre invalide.'; end if;
  insert into public.profiles(id, email, plan)
    select u.id, u.email, new_plan from auth.users u where u.id = target
    on conflict (id) do update set plan = excluded.plan;
end; $$;
revoke all on function public.admin_set_plan(uuid,text) from public, anon;
grant execute on function public.admin_set_plan(uuid,text) to authenticated;

-- Liste des comptes enrichie (avec l'offre) — remplace la précédente
drop function if exists public.admin_list_users();
create or replace function public.admin_list_users()
returns table (
  id uuid, email text, created_at timestamptz,
  last_sign_in_at timestamptz, email_confirmed_at timestamptz, approved boolean, plan text
)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Accès refusé : administrateur requis.'; end if;
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at, u.email_confirmed_at,
           coalesce(p.approved, false), coalesce(p.plan, 'free')
    from auth.users u
    left join public.profiles p on p.id = u.id
    order by coalesce(p.approved, false) asc, u.last_sign_in_at desc nulls last, u.created_at desc;
end; $$;
grant execute on function public.admin_list_users() to authenticated;

-- 1) Compteur de visites (par visiteur et par jour) --------------------
create table if not exists public.site_visits (
  visitor text not null,
  day date not null default current_date,
  hits integer not null default 1,
  primary key (visitor, day)
);
alter table public.site_visits enable row level security;
-- Aucune policy => pas d'accès direct ; tout passe par les fonctions.

-- Enregistrer une visite (appelée par le site, même non connecté)
create or replace function public.track_visit(visitor text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if visitor is null or length(visitor) < 6 or length(visitor) > 64 then return; end if;
  insert into public.site_visits(visitor, day, hits)
    values (visitor, current_date, 1)
    on conflict (visitor, day) do update set hits = site_visits.hits + 1;
end; $$;

-- 2) Statistiques (admins uniquement) ---------------------------------
create or replace function public.admin_stats()
returns json language plpgsql security definer set search_path = public, auth as $$
declare res json;
begin
  if not public.is_admin() then raise exception 'Accès refusé : administrateur requis.'; end if;
  select json_build_object(
    'views_total',     coalesce((select sum(hits) from public.site_visits), 0),
    'visitors_total',  coalesce((select count(distinct visitor) from public.site_visits), 0),
    'views_today',     coalesce((select sum(hits) from public.site_visits where day = current_date), 0),
    'visitors_today',  coalesce((select count(distinct visitor) from public.site_visits where day = current_date), 0),
    'accounts_total',  (select count(*) from auth.users),
    'accounts_pending',(select count(*) from auth.users u left join public.profiles p on p.id = u.id where coalesce(p.approved,false) = false),
    'accounts_connected',(select count(*) from auth.users where last_sign_in_at is not null)
  ) into res;
  return res;
end; $$;

-- 3) Gestion des administrateurs (admins uniquement) ------------------
create or replace function public.admin_list_admins()
returns table(email text) language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Accès refusé : administrateur requis.'; end if;
  return query select a.email from public.admins a order by a.email;
end; $$;

create or replace function public.admin_add_admin(new_email text)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Accès refusé : administrateur requis.'; end if;
  if new_email is null or position('@' in new_email) = 0 then raise exception 'E-mail invalide.'; end if;
  insert into public.admins(email) values (lower(trim(new_email))) on conflict (email) do nothing;
  -- si ce compte existe déjà, l'approuver automatiquement
  update public.profiles p set approved = true
    from auth.users u where u.id = p.id and lower(u.email) = lower(trim(new_email));
end; $$;

create or replace function public.admin_remove_admin(old_email text)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Accès refusé : administrateur requis.'; end if;
  if lower(trim(old_email)) = lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'Vous ne pouvez pas retirer votre propre accès administrateur.';
  end if;
  delete from public.admins where lower(email) = lower(trim(old_email));
end; $$;

-- 4) Permissions ------------------------------------------------------
revoke all on function public.track_visit(text)       from public;
grant  execute on function public.track_visit(text)    to anon, authenticated;
revoke all on function public.admin_stats()            from public, anon;
revoke all on function public.admin_list_admins()      from public, anon;
revoke all on function public.admin_add_admin(text)    from public, anon;
revoke all on function public.admin_remove_admin(text) from public, anon;
grant  execute on function public.admin_stats()        to authenticated;
grant  execute on function public.admin_list_admins()  to authenticated;
grant  execute on function public.admin_add_admin(text) to authenticated;
grant  execute on function public.admin_remove_admin(text) to authenticated;
