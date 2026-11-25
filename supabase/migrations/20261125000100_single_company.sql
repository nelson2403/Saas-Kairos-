-- =====================================================================
-- SAS KAIRÓS — Instalação de empresa única
-- O sistema atende uma empresa. A estrutura multi-tenant (company_id + RLS)
-- é mantida; esta configuração apenas impede a criação de uma segunda
-- empresa. Para virar SaaS no futuro basta desligar `single_company`.
-- =====================================================================

create table private.app_config (
  id              boolean primary key default true check (id), -- linha única
  single_company  boolean not null default true
);
insert into private.app_config default values;

-- Usado pela tela de primeiro acesso: o sistema já foi configurado?
create or replace function public.app_is_initialized()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.companies);
$$;

revoke execute on function public.app_is_initialized() from public, anon;
grant execute on function public.app_is_initialized() to authenticated;

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

  -- Serializa a configuração inicial (dois primeiros acessos simultâneos).
  perform pg_advisory_xact_lock(hashtext('kairos.create_company'));

  if exists (select 1 from public.company_members where user_id = v_user) then
    raise exception 'Usuário já vinculado a uma empresa' using errcode = 'P0001';
  end if;

  if (select single_company from private.app_config) and exists (select 1 from public.companies) then
    raise exception 'Empresa já configurada' using errcode = 'P0001';
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
