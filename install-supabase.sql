-- =====================================================================
--  AEM-CONSEIL — INSTALLATION COMPLÈTE DE LA BASE DE DONNÉES
--  À exécuter UNE FOIS dans Supabase : Dashboard > SQL Editor >
--  New query > coller TOUT ce fichier > Run.
--
--  Après exécution :
--   • la connexion (e-mail + mot de passe) enregistre le compte ;
--   • toutes les données (factures, devis, clients, sous-traitants,
--     réglages) sont sauvegardées SUR LE COMPTE et synchronisées
--     entre appareils, isolées par utilisateur (RLS) ;
--   • le portail destinataires et les accusés de réception fonctionnent.
--
--  NB — Deux réglages à vérifier dans Supabase > Authentication :
--   1) Providers > Email : activé.
--   2) "Confirm email" : si ACTIVÉ, chaque nouvel inscrit doit cliquer
--      le lien reçu par e-mail avant de pouvoir se connecter. Désactivez-le
--      pour un accès immédiat après création du mot de passe.
--   3) Les nouveaux comptes sont "en attente de validation" jusqu'à ce
--      qu'un administrateur les approuve (module Administration). Les
--      e-mails admins par défaut sont définis dans la section 1 ci-dessous.
-- =====================================================================




-- ############################################################
-- ### FICHIER : admin-users.sql
-- ############################################################

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


-- ############################################################
-- ### FICHIER : security-access.sql
-- ############################################################

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


-- ############################################################
-- ### FICHIER : admin-extras.sql
-- ############################################################

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


-- ############################################################
-- ### FICHIER : data-migration.sql
-- ############################################################

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


-- ############################################################
-- ### FICHIER : clients-table.sql
-- ############################################################

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


-- ############################################################
-- ### FICHIER : fournisseurs-table.sql
-- ############################################################

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


-- ############################################################
-- ### FICHIER : subcontractors-table.sql
-- ############################################################

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


-- ############################################################
-- ### FICHIER : portail-access.sql
-- ############################################################

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


-- ############################################################
-- ### FICHIER : acks-table.sql
-- ############################################################

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


-- ############################################################
-- ### FICHIER : delete-account.sql
-- ############################################################

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
