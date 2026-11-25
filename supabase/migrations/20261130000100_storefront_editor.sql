-- =====================================================================
-- SAS KAIRÓS — Fase 7: "Personalizar minha loja"
--
-- Regras:
--  * Rascunho e publicado separados: a loja pública lê SOMENTE o publicado.
--  * Publicar = copiar o rascunho para o publicado e guardar uma versão
--    numerada (imutável). Restaurar = copiar uma versão para o rascunho.
--  * O documento é validado na aplicação (formato, cores, links) e de novo
--    na hora de exibir; o banco limita tipo e tamanho.
--  * Imagens da loja (logo, destaque, banners) no bucket público
--    store-assets, pasta da empresa; envio só por proprietário/administrador.
-- =====================================================================

create table public.storefront (
  company_id         uuid primary key references public.companies (id) on delete cascade,
  draft              jsonb not null default '{}'::jsonb check (jsonb_typeof(draft) = 'object' and pg_column_size(draft) < 262144),
  published          jsonb check (published is null or (jsonb_typeof(published) = 'object' and pg_column_size(published) < 262144)),
  draft_updated_at   timestamptz not null default now(),
  draft_updated_by   uuid,
  published_version  int,
  published_at       timestamptz,
  published_by       uuid
);

create table public.storefront_versions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  version       int not null check (version > 0),
  snapshot      jsonb not null,
  note          text check (note is null or char_length(note) <= 200),
  published_by  uuid,
  published_at  timestamptz not null default now(),
  unique (company_id, version)
);

create trigger storefront_versions_immutable before update or delete on public.storefront_versions
  for each row execute function private.forbid_change();

-- ---------------------------------------------------------------------
-- API do editor (proprietário/administrador)
-- ---------------------------------------------------------------------
create or replace function public.fn_save_storefront_draft(p_draft jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.current_company_id();
  v_now timestamptz := now();
begin
  if v_company is null or not private.has_company_role(v_company, array['owner', 'admin']) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if p_draft is null or jsonb_typeof(p_draft) <> 'object' then
    raise exception 'Configuração inválida' using errcode = 'P0001';
  end if;
  if pg_column_size(p_draft) >= 262144 then
    raise exception 'Configuração grande demais' using errcode = 'P0001';
  end if;
  insert into public.storefront (company_id, draft, draft_updated_at, draft_updated_by)
  values (v_company, p_draft, v_now, (select auth.uid()))
  on conflict (company_id) do update
    set draft = excluded.draft, draft_updated_at = excluded.draft_updated_at, draft_updated_by = excluded.draft_updated_by;
  return v_now;
end;
$$;
revoke execute on function public.fn_save_storefront_draft(jsonb) from public, anon;
grant execute on function public.fn_save_storefront_draft(jsonb) to authenticated;

create or replace function public.fn_publish_storefront(p_note text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.current_company_id();
  v_row public.storefront;
  v_version int;
begin
  if v_company is null or not private.has_company_role(v_company, array['owner', 'admin']) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  select * into v_row from public.storefront where company_id = v_company for update;
  if v_row.company_id is null then
    raise exception 'Salve o rascunho antes de publicar' using errcode = 'P0001';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.storefront_versions where company_id = v_company;
  insert into public.storefront_versions (company_id, version, snapshot, note, published_by)
  values (v_company, v_version, v_row.draft, nullif(btrim(p_note), ''), (select auth.uid()));
  update public.storefront
     set published = v_row.draft, published_version = v_version, published_at = now(), published_by = (select auth.uid())
   where company_id = v_company;
  return v_version;
end;
$$;
revoke execute on function public.fn_publish_storefront(text) from public, anon;
grant execute on function public.fn_publish_storefront(text) to authenticated;

-- Restaurar = levar a versão para o RASCUNHO (publicar continua sendo um passo explícito).
create or replace function public.fn_restore_storefront_version(p_version int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.current_company_id();
  v_snapshot jsonb;
begin
  if v_company is null or not private.has_company_role(v_company, array['owner', 'admin']) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  select snapshot into v_snapshot from public.storefront_versions where company_id = v_company and version = p_version;
  if v_snapshot is null then
    raise exception 'Versão não encontrada' using errcode = 'P0001';
  end if;
  update public.storefront
     set draft = v_snapshot, draft_updated_at = now(), draft_updated_by = (select auth.uid())
   where company_id = v_company;
end;
$$;
revoke execute on function public.fn_restore_storefront_version(int) from public, anon;
grant execute on function public.fn_restore_storefront_version(int) to authenticated;

-- Leitura pública: somente a versão publicada.
create or replace function public.store_theme()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select published from public.storefront where company_id = private.store_company_id();
$$;
revoke execute on function public.store_theme() from public;
grant execute on function public.store_theme() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Imagens da loja
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('store-assets', 'store-assets', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy store_assets_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'store-assets'
    and (storage.foldername(name))[1] = (select private.current_company_id())::text
    and (storage.foldername(name))[2] = 'store'
    and private.has_company_role((select private.current_company_id()), array['owner', 'admin'])
  );

-- ---------------------------------------------------------------------
-- Auditoria e RLS
-- ---------------------------------------------------------------------
create trigger storefront_versions_audit after insert on public.storefront_versions
  for each row execute function private.audit_row();

alter table public.storefront          enable row level security;
alter table public.storefront_versions enable row level security;

create policy storefront_select on public.storefront for select to authenticated
  using (private.is_company_member(company_id));
create policy storefront_versions_select on public.storefront_versions for select to authenticated
  using (private.is_company_member(company_id));
revoke insert, update, delete, truncate on public.storefront, public.storefront_versions from anon, authenticated;
