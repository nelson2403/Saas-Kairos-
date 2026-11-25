-- =====================================================================
-- SAS KAIRÓS — Fotos de produtos (Supabase Storage)
-- Bucket público para leitura (a loja exibe as fotos); envio e exclusão
-- somente por proprietário/administrador/gerente, dentro da pasta da empresa:
--   product-images/<company_id>/products/<product_id>/<arquivo>
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy product_images_storage_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select private.current_company_id())::text
    and (storage.foldername(name))[2] = 'products'
    and private.has_company_role((select private.current_company_id()), array['owner', 'admin', 'manager'])
  );

create policy product_images_storage_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select private.current_company_id())::text
    and private.has_company_role((select private.current_company_id()), array['owner', 'admin', 'manager'])
  );

-- ---------------------------------------------------------------------
-- Registro das fotos (ordem e texto alternativo)
-- ---------------------------------------------------------------------
create table public.product_images (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  product_id    uuid not null,
  storage_path  text not null unique,
  alt           text check (alt is null or char_length(alt) <= 200),
  sort_order    int not null default 0,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  foreign key (company_id, product_id) references public.products (company_id, id) on delete cascade,
  -- o arquivo precisa estar na pasta da própria empresa e do próprio produto
  check (storage_path like company_id::text || '/products/' || product_id::text || '/%')
);
create index product_images_product_idx on public.product_images (product_id, sort_order);

-- Limite de fotos por produto.
create or replace function private.limit_product_images()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.product_images where product_id = new.product_id) >= 8 then
    raise exception 'Limite de 8 fotos por produto' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger product_images_limit before insert on public.product_images
  for each row execute function private.limit_product_images();

create trigger product_images_audit after insert or delete on public.product_images
  for each row execute function private.audit_row();

alter table public.product_images enable row level security;

create policy product_images_select on public.product_images for select to authenticated
  using (private.is_company_member(company_id));
create policy product_images_insert on public.product_images for insert to authenticated
  with check (private.has_company_role(company_id, array['owner', 'admin', 'manager']));
create policy product_images_update on public.product_images for update to authenticated
  using (private.has_company_role(company_id, array['owner', 'admin', 'manager']))
  with check (private.has_company_role(company_id, array['owner', 'admin', 'manager']));
create policy product_images_delete on public.product_images for delete to authenticated
  using (private.has_company_role(company_id, array['owner', 'admin', 'manager']));

revoke insert, update, delete, truncate on public.product_images from anon;
