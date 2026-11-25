-- =====================================================================
-- SAS KAIRÓS — Equipe: acessos, papéis e transferência de propriedade
--
-- Regras:
--  * Só proprietário e administrador gerenciam a equipe.
--  * Ninguém altera o próprio papel/situação (evita perder o acesso por engano).
--  * O proprietário só deixa de ser proprietário transferindo a propriedade.
--  * Administrador não concede nem altera o papel "administrador"
--    (somente o proprietário).
--  * A conta de login (auth.users) é criada pelo servidor com a chave
--    secreta; aqui só se vincula a pessoa à empresa.
-- =====================================================================

create or replace function private.role_rank(p_key text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_key when 'owner' then 1 when 'admin' then 2 when 'manager' then 3 when 'operator' then 4 when 'viewer' then 5 else 9 end;
$$;

-- Valida se o usuário atual pode mexer no membro (e, opcionalmente, conceder o papel).
-- Devolve o papel atual do membro. Trava a linha do membro.
create or replace function private.assert_can_manage_member(p_company uuid, p_member uuid, p_new_role text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
  v_target_user uuid;
  v_target_role text;
begin
  select r.key into v_actor_role
    from public.company_members m join public.roles r on r.id = m.role_id
   where m.company_id = p_company and m.user_id = (select auth.uid()) and m.status = 'active';
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;

  if p_member is not null then
    select m.user_id, r.key into v_target_user, v_target_role
      from public.company_members m join public.roles r on r.id = m.role_id
     where m.id = p_member and m.company_id = p_company
       for update of m;
    if v_target_user is null then
      raise exception 'Pessoa não encontrada na equipe' using errcode = 'P0001';
    end if;
    if v_target_user = (select auth.uid()) then
      raise exception 'Você não pode alterar o seu próprio acesso' using errcode = 'P0001';
    end if;
    if v_target_role = 'owner' then
      raise exception 'O acesso do proprietário só muda com a transferência de propriedade' using errcode = 'P0001';
    end if;
    if v_actor_role = 'admin' and v_target_role = 'admin' then
      raise exception 'Somente o proprietário altera outro administrador' using errcode = '42501';
    end if;
  end if;

  if p_new_role is not null then
    if p_new_role not in ('admin', 'manager', 'operator', 'viewer') then
      raise exception 'Papel inválido' using errcode = 'P0001';
    end if;
    if p_new_role = 'admin' and v_actor_role <> 'owner' then
      raise exception 'Somente o proprietário concede o papel de administrador' using errcode = '42501';
    end if;
  end if;

  return v_target_role;
end;
$$;

-- ---------------------------------------------------------------------
-- Lista da equipe (com e-mail de login) — proprietário/administrador
-- ---------------------------------------------------------------------
create or replace function public.fn_team_members()
returns table (
  member_id   uuid,
  user_id     uuid,
  email       text,
  full_name   text,
  role_key    text,
  role_name   text,
  status      text,
  created_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.current_company_id();
begin
  if v_company is null or not private.has_company_role(v_company, array['owner', 'admin']) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return query
    select m.id, m.user_id, u.email::text, p.full_name, r.key, r.name, m.status, m.created_at
      from public.company_members m
      join public.roles r on r.id = m.role_id
      join auth.users u on u.id = m.user_id
      left join public.profiles p on p.id = m.user_id
     where m.company_id = v_company
     order by (m.status = 'active') desc, private.role_rank(r.key), coalesce(p.full_name, u.email::text);
end;
$$;
revoke execute on function public.fn_team_members() from public, anon;
grant execute on function public.fn_team_members() to authenticated;

-- ---------------------------------------------------------------------
-- Adicionar pessoa (a conta de login já deve existir)
-- ---------------------------------------------------------------------
create or replace function public.fn_add_member(p_email text, p_role text, p_full_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.current_company_id();
  v_user uuid;
  v_role uuid;
  v_member uuid;
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
begin
  if v_company is null then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  perform private.assert_can_manage_member(v_company, null, p_role);

  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'Conta de acesso não encontrada para este e-mail' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.company_members where user_id = v_user) then
    raise exception 'Esta pessoa já faz parte da equipe' using errcode = 'P0001';
  end if;
  if v_name is not null and char_length(v_name) > 120 then
    raise exception 'Nome muito longo' using errcode = 'P0001';
  end if;

  select id into v_role from public.roles where company_id is null and key = p_role;
  insert into public.company_members (company_id, user_id, role_id, status)
  values (v_company, v_user, v_role, 'active')
  returning id into v_member;

  if v_name is not null then
    insert into public.profiles (id, full_name) values (v_user, v_name)
    on conflict (id) do update set full_name = coalesce(public.profiles.full_name, excluded.full_name);
  end if;
  return v_member;
end;
$$;
revoke execute on function public.fn_add_member(text, text, text) from public, anon;
grant execute on function public.fn_add_member(text, text, text) to authenticated;

-- Checagem usada pelo servidor antes de redefinir a senha de alguém.
create or replace function public.fn_member_user_for_admin(p_member uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.current_company_id();
begin
  if v_company is null then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  perform private.assert_can_manage_member(v_company, p_member);
  return (select user_id from public.company_members where id = p_member);
end;
$$;
revoke execute on function public.fn_member_user_for_admin(uuid) from public, anon;
grant execute on function public.fn_member_user_for_admin(uuid) to authenticated;

create or replace function public.fn_set_member_role(p_member uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.current_company_id();
begin
  if v_company is null then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  perform private.assert_can_manage_member(v_company, p_member, p_role);
  update public.company_members
     set role_id = (select id from public.roles where company_id is null and key = p_role)
   where id = p_member;
end;
$$;
revoke execute on function public.fn_set_member_role(uuid, text) from public, anon;
grant execute on function public.fn_set_member_role(uuid, text) to authenticated;

-- Suspender corta o acesso na hora (toda a RLS exige status = 'active').
create or replace function public.fn_set_member_status(p_member uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.current_company_id();
begin
  if v_company is null then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'Situação inválida' using errcode = 'P0001';
  end if;
  perform private.assert_can_manage_member(v_company, p_member);
  update public.company_members set status = p_status where id = p_member;
end;
$$;
revoke execute on function public.fn_set_member_status(uuid, text) from public, anon;
grant execute on function public.fn_set_member_status(uuid, text) to authenticated;

-- Transferência: o destinatário vira proprietário e quem transfere vira administrador.
create or replace function public.fn_transfer_ownership(p_member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.current_company_id();
  v_me uuid := (select auth.uid());
  v_my_member uuid;
  v_target_user uuid;
  v_target_status text;
begin
  if v_company is null or not private.has_company_role(v_company, array['owner']) then
    raise exception 'Somente o proprietário transfere a propriedade' using errcode = '42501';
  end if;
  -- trava as duas linhas em ordem de id (sem deadlock)
  perform 1 from public.company_members
   where company_id = v_company and (id = p_member or user_id = v_me)
   order by id for update;
  select id into v_my_member from public.company_members where company_id = v_company and user_id = v_me;
  select user_id, status into v_target_user, v_target_status from public.company_members where id = p_member and company_id = v_company;
  if v_target_user is null then
    raise exception 'Pessoa não encontrada na equipe' using errcode = 'P0001';
  end if;
  if v_target_user = v_me then
    raise exception 'Você já é o proprietário' using errcode = 'P0001';
  end if;
  if v_target_status <> 'active' then
    raise exception 'Reative o acesso da pessoa antes de transferir' using errcode = 'P0001';
  end if;
  update public.company_members set role_id = (select id from public.roles where company_id is null and key = 'owner') where id = p_member;
  update public.company_members set role_id = (select id from public.roles where company_id is null and key = 'admin') where id = v_my_member;
end;
$$;
revoke execute on function public.fn_transfer_ownership(uuid) from public, anon;
grant execute on function public.fn_transfer_ownership(uuid) to authenticated;

-- Membros só mudam pelas funções acima.
revoke insert, update, delete, truncate on public.company_members from anon, authenticated;
