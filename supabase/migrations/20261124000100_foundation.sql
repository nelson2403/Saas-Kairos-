-- =====================================================================
-- SAS KAIRÓS — Fase 1: fundação
-- Multi-tenant (company_id), papéis, membros, perfis, auditoria,
-- idempotência da fila offline, push e esqueleto de integrações.
-- =====================================================================

-- Funções auxiliares ficam num schema NÃO exposto pela API do Supabase.
create schema if not exists private;
grant usage on schema private to authenticated, anon;

-- ---------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Empresas
-- ---------------------------------------------------------------------
create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 2 and 120),
  legal_name  text check (legal_name is null or char_length(legal_name) <= 200),
  document    text check (document is null or document ~ '^[0-9]{11}$|^[0-9]{14}$'),
  email       text check (email is null or char_length(email) <= 254),
  phone       text check (phone is null or char_length(phone) <= 30),
  timezone    text not null default 'America/Sao_Paulo',
  currency    char(3) not null default 'BRL',
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger companies_updated_at before update on public.companies
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Perfis (1:1 com auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (full_name is null or char_length(full_name) <= 120),
  phone       text check (phone is null or char_length(phone) <= 30),
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------
-- Papéis e membros
-- ---------------------------------------------------------------------
create table public.roles (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references public.companies (id) on delete cascade, -- null = papel do sistema
  key          text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name         text not null,
  description  text,
  permissions  jsonb not null default '[]'::jsonb,
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  unique nulls not distinct (company_id, key)
);

insert into public.roles (company_id, key, name, description, permissions, is_system) values
  (null, 'owner',    'Proprietário', 'Acesso total, inclusive integrações e membros', '["*"]', true),
  (null, 'admin',    'Administrador', 'Gestão completa exceto transferência de propriedade', '["*"]', true),
  (null, 'manager',  'Gerente', 'Operação, relatórios e financeiro', '["operations","reports","finance"]', true),
  (null, 'operator', 'Operador', 'Estoque, produção e pedidos', '["operations"]', true),
  (null, 'viewer',   'Leitura', 'Somente consulta', '["read"]', true);

create table public.company_members (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role_id     uuid not null references public.roles (id),
  status      text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, user_id)
);

create index company_members_user_idx on public.company_members (user_id);

create trigger company_members_updated_at before update on public.company_members
  for each row execute function private.set_updated_at();

-- Base de toda RLS. SECURITY DEFINER evita recursão de políticas em company_members.
create or replace function private.is_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

create or replace function private.has_company_role(p_company_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members m
    join public.roles r on r.id = m.role_id
    where m.company_id = p_company_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and r.key = any (p_roles)
  );
$$;

grant execute on function private.is_company_member(uuid) to authenticated;
grant execute on function private.has_company_role(uuid, text[]) to authenticated;
revoke execute on function private.is_company_member(uuid) from anon, public;
revoke execute on function private.has_company_role(uuid, text[]) from anon, public;

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  company_id  uuid, -- sem FK: o log sobrevive à remoção da empresa/registro auditado
  actor_id    uuid, -- sem FK: o registro sobrevive à remoção do usuário
  action      text not null,
  entity      text not null,
  entity_id   text,
  changes     jsonb,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index audit_logs_company_created_idx on public.audit_logs (company_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity, entity_id);

-- Trigger genérico: registra apenas campos alterados, nunca colunas sensíveis.
create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb;
  v_ignored text[] := array['updated_at', 'created_at'];
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('from', v_old -> n.key, 'to', n.value))
      into v_changes
      from jsonb_each(v_new) n
     where n.key <> all (v_ignored)
       and (v_old -> n.key) is distinct from n.value;
    if v_changes is null then
      return new;
    end if;
  elsif tg_op = 'INSERT' then
    v_changes := v_new - v_ignored;
  else
    v_changes := v_old - v_ignored;
  end if;

  insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, changes)
  values (
    case when tg_table_name = 'companies' then (v_row ->> 'id')::uuid
         else (v_row ->> 'company_id')::uuid end,
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    v_row ->> 'id',
    v_changes
  );

  return coalesce(new, old);
end;
$$;

create trigger companies_audit after insert or update or delete on public.companies
  for each row execute function private.audit_row();
create trigger company_members_audit after insert or update or delete on public.company_members
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------
-- Criação da empresa pelo primeiro usuário (onboarding)
-- ---------------------------------------------------------------------
create or replace function public.create_company_with_owner(p_name text, p_document text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_company uuid;
  v_owner_role uuid;
begin
  if v_user is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;

  -- Versão 1: cada usuário pertence a no máximo uma empresa.
  if exists (select 1 from public.company_members where user_id = v_user) then
    raise exception 'Usuário já vinculado a uma empresa' using errcode = 'P0001';
  end if;

  select id into v_owner_role from public.roles where company_id is null and key = 'owner';

  insert into public.companies (name, document)
  values (btrim(p_name), nullif(regexp_replace(coalesce(p_document, ''), '\D', '', 'g'), ''))
  returning id into v_company;

  insert into public.company_members (company_id, user_id, role_id, status)
  values (v_company, v_user, v_owner_role, 'active');

  return v_company;
end;
$$;

revoke execute on function public.create_company_with_owner(text, text) from public, anon;
grant execute on function public.create_company_with_owner(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Idempotência de operações vindas da fila offline / reenvios
-- ---------------------------------------------------------------------
create table public.client_operations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  user_id       uuid not null,
  client_op_id  uuid not null,
  operation     text not null,
  status        text not null check (status in ('applied', 'rejected', 'conflict')),
  result        jsonb,
  created_at    timestamptz not null default now(),
  unique (company_id, client_op_id)
);

-- ---------------------------------------------------------------------
-- Web Push
-- ---------------------------------------------------------------------
create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

-- ---------------------------------------------------------------------
-- Integrações (esqueleto: Asaas e Evolution API)
-- ---------------------------------------------------------------------
create table public.integrations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  provider         text not null check (provider in ('asaas', 'whatsapp_evolution')),
  environment      text check (environment in ('sandbox', 'production')),
  status           text not null default 'not_configured'
                   check (status in ('not_configured', 'configured', 'connected', 'disconnected', 'error')),
  config           jsonb not null default '{}'::jsonb, -- somente dados NÃO sensíveis
  last_checked_at  timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, provider)
);

create trigger integrations_updated_at before update on public.integrations
  for each row execute function private.set_updated_at();
create trigger integrations_audit after insert or update or delete on public.integrations
  for each row execute function private.audit_row();

-- Credenciais criptografadas (AES-256-GCM no servidor). Sem políticas RLS:
-- inacessível a anon/authenticated; somente o servidor com a secret key.
create table public.integration_secrets (
  id              uuid primary key default gen_random_uuid(),
  integration_id  uuid not null references public.integrations (id) on delete cascade,
  company_id      uuid not null references public.companies (id) on delete cascade,
  name            text not null,
  ciphertext      text not null,
  iv              text not null,
  auth_tag        text not null,
  last4           text,
  key_version     int not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (integration_id, name)
);

create trigger integration_secrets_updated_at before update on public.integration_secrets
  for each row execute function private.set_updated_at();

create table public.webhook_events (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies (id) on delete cascade,
  provider      text not null,
  event_id      text not null,
  event_type    text,
  payload       jsonb not null,
  status        text not null default 'received'
                check (status in ('received', 'processing', 'processed', 'ignored', 'failed')),
  attempts      int not null default 0,
  error         text,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  unique (provider, event_id)
);

create index webhook_events_company_idx on public.webhook_events (company_id, received_at desc);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.companies            enable row level security;
alter table public.profiles             enable row level security;
alter table public.roles                enable row level security;
alter table public.company_members      enable row level security;
alter table public.audit_logs           enable row level security;
alter table public.client_operations    enable row level security;
alter table public.push_subscriptions   enable row level security;
alter table public.integrations         enable row level security;
alter table public.integration_secrets  enable row level security;
alter table public.webhook_events       enable row level security;

-- companies
create policy companies_select on public.companies for select to authenticated
  using (private.is_company_member(id));
create policy companies_update on public.companies for update to authenticated
  using (private.has_company_role(id, array['owner', 'admin']))
  with check (private.has_company_role(id, array['owner', 'admin']));

-- profiles: o próprio perfil e os colegas da mesma empresa
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.company_members m
      where m.user_id = profiles.id and private.is_company_member(m.company_id)
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- roles
create policy roles_select on public.roles for select to authenticated
  using (company_id is null or private.is_company_member(company_id));

-- company_members (gestão de membros entra com o módulo Configurações → Administrador)
create policy company_members_select on public.company_members for select to authenticated
  using (user_id = (select auth.uid()) or private.is_company_member(company_id));

-- audit_logs: leitura para proprietário/administrador; escrita só por triggers/funções
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (private.has_company_role(company_id, array['owner', 'admin']));

-- client_operations: o usuário vê o resultado das próprias operações
create policy client_operations_select on public.client_operations for select to authenticated
  using (user_id = (select auth.uid()) and private.is_company_member(company_id));

-- push_subscriptions: cada usuário gerencia os próprios dispositivos
create policy push_subscriptions_all on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid()) and private.is_company_member(company_id))
  with check (user_id = (select auth.uid()) and private.is_company_member(company_id));

-- integrations: proprietário/administrador
create policy integrations_select on public.integrations for select to authenticated
  using (private.has_company_role(company_id, array['owner', 'admin']));
create policy integrations_insert on public.integrations for insert to authenticated
  with check (private.has_company_role(company_id, array['owner', 'admin']));
create policy integrations_update on public.integrations for update to authenticated
  using (private.has_company_role(company_id, array['owner', 'admin']))
  with check (private.has_company_role(company_id, array['owner', 'admin']));

-- integration_secrets: nenhuma política (proposital)

-- webhook_events: leitura para proprietário/administrador
create policy webhook_events_select on public.webhook_events for select to authenticated
  using (company_id is not null and private.has_company_role(company_id, array['owner', 'admin']));

-- Segredos nunca são legíveis pela API, mesmo que alguém crie uma política por engano.
revoke all on public.integration_secrets from anon, authenticated;
