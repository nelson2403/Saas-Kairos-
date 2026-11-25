-- =====================================================================
-- SAS KAIRÓS — Fase 6: loja virtual (catálogo, carrinho, checkout)
--
-- Regras:
--  * A loja pública lê SOMENTE por funções que devolvem campos públicos
--    (nome, preço, fotos, disponibilidade). Custo, saldo, clientes e pedidos
--    de outros nunca saem por elas.
--  * O checkout roda no servidor (chave secreta), com limite de tentativas e
--    chave de idempotência; preços e estoque vêm sempre do banco.
--  * Pedido da loja reserva o estoque com PRAZO (reserved_until). Reserva
--    vencida sem pagamento é cancelada e o estoque volta a ficar disponível.
--  * Pagamento online entra na Fase 8 (Asaas). Até lá a equipe registra o
--    pagamento no painel; a loja mostra as instruções definidas pela empresa.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Empresa atendida pela loja (instalação de empresa única)
-- ---------------------------------------------------------------------
alter table private.app_config add column store_company_id uuid references public.companies (id) on delete set null;

create or replace function private.store_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select store_company_id from private.app_config),
    (select id from public.companies order by created_at, id limit 1)
  );
$$;
revoke execute on function private.store_company_id() from public, anon, authenticated;

-- Configuração da loja (companies.settings.store) com valores padrão.
create or replace function private.store_config(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'enabled', false,
           'whatsapp', null,
           'pickup_enabled', true,
           'pickup_address', null,
           'delivery_enabled', false,
           'delivery_fee', 0,
           'delivery_notes', null,
           'payment_instructions', 'Após o pedido, entraremos em contato para combinar o pagamento.',
           'reservation_hours', 48
         ) || coalesce(c.settings -> 'store', '{}'::jsonb)
    from public.companies c where c.id = p_company_id;
$$;
revoke execute on function private.store_config(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Pedidos da loja: entrega, link público e idempotência
-- ---------------------------------------------------------------------
alter table public.orders
  add column delivery_method   text check (delivery_method is null or delivery_method in ('retirada', 'entrega')),
  add column delivery_address  jsonb,
  add column public_token      uuid not null default gen_random_uuid(),
  add column idempotency_key   text check (idempotency_key is null or char_length(idempotency_key) between 8 and 100);
create unique index orders_public_token_uq on public.orders (public_token);
create unique index orders_idempotency_uq on public.orders (company_id, idempotency_key) where idempotency_key is not null;
create index orders_reserved_until_idx on public.orders (reserved_until) where status = 'pending' and reserved_until is not null;

-- O endereço de entrega é dado pessoal: auditoria mascarada.
drop trigger orders_audit on public.orders;
create trigger orders_audit after insert or update on public.orders
  for each row execute function private.audit_row_masked('delivery_address', 'notes');

-- ---------------------------------------------------------------------
-- Núcleo de criação de pedido (painel e loja usam a mesma regra)
-- ---------------------------------------------------------------------
create or replace function private.create_order(
  p_company_id      uuid,
  p_channel         text,
  p_customer_id     uuid,
  p_items           jsonb,
  p_discount        numeric,
  p_shipping        numeric,
  p_due_date        date,
  p_notes           text,
  p_reserved_until  timestamptz,
  p_delivery_method text,
  p_delivery_address jsonb,
  p_idempotency_key text,
  p_store_only      boolean
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_number bigint;
  v_item jsonb;
  v_product public.products;
  v_qty numeric;
  v_price numeric;
  v_subtotal numeric := 0;
  v_total numeric;
  v_seen uuid[] := '{}';
  v_sort int := 0;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Inclua ao menos um produto' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Pedido com itens demais (máximo 200)' using errcode = 'P0001';
  end if;
  if coalesce(p_discount, 0) < 0 or coalesce(p_shipping, 0) < 0 then
    raise exception 'Desconto e frete não podem ser negativos' using errcode = 'P0001';
  end if;

  v_number := private.next_document_number(p_company_id, 'order');
  insert into public.orders (company_id, number, channel, customer_id, subtotal, discount, shipping, total, due_date, notes,
                             reserved_until, delivery_method, delivery_address, idempotency_key, created_by)
  values (p_company_id, v_number, p_channel, p_customer_id, 0, 0, 0, 0, p_due_date, nullif(btrim(p_notes), ''),
          p_reserved_until, p_delivery_method, p_delivery_address, p_idempotency_key, (select auth.uid()))
  returning * into v_order;

  -- ordem fixa de travamento (id do produto)
  for v_item in select e from jsonb_array_elements(p_items) e order by (e ->> 'product_id')
  loop
    select * into v_product from public.products where id = (v_item ->> 'product_id')::uuid and company_id = p_company_id;
    if v_product.id is null or (p_store_only and not v_product.show_in_store) then
      raise exception 'Produto não encontrado' using errcode = 'P0001';
    end if;
    if v_product.status <> 'active' then
      raise exception '"%" não está disponível para venda', v_product.name using errcode = 'P0001';
    end if;
    if v_product.id = any (v_seen) then
      raise exception '"%" aparece mais de uma vez', v_product.name using errcode = 'P0001';
    end if;
    v_seen := v_seen || v_product.id;
    v_qty := (v_item ->> 'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantidade inválida para "%"', v_product.name using errcode = 'P0001';
    end if;
    -- na loja o preço é sempre o do cadastro
    v_price := round(case when p_store_only then v_product.sale_price
                          else coalesce((v_item ->> 'unit_price')::numeric, v_product.sale_price) end, 2);
    if v_price < 0 then
      raise exception 'Preço inválido para "%"', v_product.name using errcode = 'P0001';
    end if;

    perform private.reserve_product(p_company_id, v_product.id, v_qty, v_product.name);
    insert into public.order_items (company_id, order_id, product_id, quantity, unit_price, total, sort_order)
    values (p_company_id, v_order.id, v_product.id, v_qty, v_price, round(v_qty * v_price, 2), v_sort);
    v_subtotal := v_subtotal + round(v_qty * v_price, 2);
    v_sort := v_sort + 1;
  end loop;

  v_total := v_subtotal - round(coalesce(p_discount, 0), 2) + round(coalesce(p_shipping, 0), 2);
  if v_total < 0 then
    raise exception 'Desconto maior que o valor do pedido' using errcode = 'P0001';
  end if;
  update public.orders
     set subtotal = v_subtotal, discount = round(coalesce(p_discount, 0), 2), shipping = round(coalesce(p_shipping, 0), 2), total = v_total
   where id = v_order.id
  returning * into v_order;

  if v_total > 0 then
    insert into public.financial_transactions (company_id, type, category_id, description, amount, due_date, competence_date,
                                               customer_id, source_type, source_id, created_by)
    values (p_company_id, 'income', private.category_id('sales'), 'Pedido ' || v_number, v_total,
            coalesce(p_due_date, v_today), v_today, p_customer_id, 'order', v_order.id, (select auth.uid()));
  end if;
  return v_order;
end;
$$;
revoke execute on function private.create_order(uuid, text, uuid, jsonb, numeric, numeric, date, text, timestamptz, text, jsonb, text, boolean) from public, anon, authenticated;

-- Painel: mesma assinatura da Fase 5, agora usando o núcleo comum.
create or replace function public.fn_create_order(
  p_client_op_id  uuid,
  p_customer_id   uuid,
  p_items         jsonb,
  p_discount      numeric default 0,
  p_shipping      numeric default 0,
  p_due_date      date default null,
  p_notes         text default null,
  p_payment       jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.current_company_id();
  v_existing jsonb;
  v_order public.orders;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_result jsonb;
begin
  if v_company is null or not private.has_company_role(v_company, array['owner', 'admin', 'manager', 'operator']) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  v_existing := private.claim_client_op(v_company, p_client_op_id);
  if v_existing is not null then
    return v_existing;
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers where id = p_customer_id and company_id = v_company and anonymized_at is null
  ) then
    raise exception 'Cliente inválido' using errcode = 'P0001';
  end if;

  v_order := private.create_order(v_company, 'manual', p_customer_id, p_items, p_discount, p_shipping, p_due_date, p_notes,
                                  null, null, null, null, false);
  if p_payment is not null then
    perform private.confirm_order_payment(v_order.id, p_payment ->> 'method', coalesce((p_payment ->> 'paid_at')::date, v_today), 'manual', null);
  end if;

  v_result := jsonb_build_object('order_id', v_order.id, 'number', v_order.number, 'total', v_order.total,
                                 'status', case when p_payment is null then 'pending' else 'paid' end);
  perform private.record_client_op(v_company, p_client_op_id, 'order.create', v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- Reservas vencidas: cancela o pedido e devolve o estoque disponível
-- ---------------------------------------------------------------------
create or replace function private.expire_reservations()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_count int := 0;
begin
  for v_order in
    select id from public.orders
     where status = 'pending' and reserved_until is not null and reserved_until < now()
     order by reserved_until
     for update skip locked
  loop
    perform private.release_reservation(v_order.id);
    update public.financial_transactions set status = 'canceled'
     where source_type = 'order' and source_id = v_order.id and status = 'open';
    perform set_config('kairos.status_note', 'Reserva expirada sem pagamento', true);
    update public.orders set status = 'canceled', close_reason = 'Reserva expirada sem pagamento', closed_at = now()
     where id = v_order.id;
    v_count := v_count + 1;
  end loop;
  perform set_config('kairos.status_note', '', true);
  return v_count;
end;
$$;
revoke execute on function private.expire_reservations() from public, anon, authenticated;

create or replace function public.fn_expire_reservations()
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- usuários do painel (qualquer membro) ou o servidor (agendamento)
  if (select auth.uid()) is not null and private.current_company_id() is null then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return private.expire_reservations();
end;
$$;
revoke execute on function public.fn_expire_reservations() from public, anon;
grant execute on function public.fn_expire_reservations() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Limite de tentativas (checkout e outras rotas públicas)
-- ---------------------------------------------------------------------
create table private.rate_limits (
  bucket        text not null,
  window_start  timestamptz not null,
  hits          int not null default 0,
  primary key (bucket, window_start)
);

create or replace function public.fn_rate_limit(p_bucket text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into private.rate_limits as r (bucket, window_start, hits) values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;
  -- limpeza ocasional de janelas antigas
  if random() < 0.02 then
    delete from private.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_max;
end;
$$;
revoke execute on function public.fn_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.fn_rate_limit(text, int, int) to service_role;

-- ---------------------------------------------------------------------
-- Leitura pública da loja (anon): somente campos públicos
-- ---------------------------------------------------------------------
create or replace function public.store_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('company_name', c.name) || private.store_config(c.id)
    from public.companies c where c.id = private.store_company_id();
$$;

create or replace function public.store_categories()
returns table (id uuid, name text, parent_id uuid, products bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name, c.parent_id, count(p.id)
    from public.product_categories c
    join public.products p on p.category_id = c.id and p.status = 'active' and p.show_in_store
   where c.company_id = private.store_company_id() and c.active
   group by c.id, c.name, c.parent_id, c.sort_order
   order by c.sort_order, c.name;
$$;

create or replace function private.store_main_image(p_product_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select storage_path from public.product_images where product_id = p_product_id order by sort_order, created_at limit 1;
$$;
revoke execute on function private.store_main_image(uuid) from public, anon, authenticated;

create or replace function public.store_products(
  p_category uuid default null,
  p_search   text default null,
  p_limit    int default 48,
  p_offset   int default 0
)
returns table (id uuid, slug text, name text, price numeric, category_id uuid, category_name text,
               image_path text, available numeric, total bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select p.*, cat.name as cat_name
      from public.products p
      left join public.product_categories cat on cat.id = p.category_id
     where p.company_id = private.store_company_id() and p.status = 'active' and p.show_in_store
       and (p_category is null or p.category_id = p_category
            or p.category_id in (select c.id from public.product_categories c where c.parent_id = p_category))
       and (coalesce(btrim(p_search), '') = '' or p.name ilike '%' || btrim(p_search) || '%')
  )
  select v.id, v.slug, v.name, v.sale_price, v.category_id, v.cat_name,
         private.store_main_image(v.id),
         greatest(coalesce(b.quantity - b.reserved_quantity, 0), 0),
         count(*) over ()
    from visible v
    left join public.stock_balances b on b.company_id = v.company_id and b.product_id = v.id
   order by (coalesce(b.quantity - b.reserved_quantity, 0) > 0) desc, v.created_at desc, v.id
   limit least(greatest(coalesce(p_limit, 48), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.store_product(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', p.id, 'slug', p.slug, 'name', p.name, 'description', p.description, 'price', p.sale_price,
           'sku', p.sku, 'unit', u.code,
           'category', case when cat.id is null then null else jsonb_build_object('id', cat.id, 'name', cat.name) end,
           'available', greatest(coalesce(b.quantity - b.reserved_quantity, 0), 0),
           'images', coalesce((select jsonb_agg(jsonb_build_object('path', i.storage_path, 'alt', i.alt) order by i.sort_order, i.created_at)
                                 from public.product_images i where i.product_id = p.id), '[]'::jsonb),
           'updated_at', p.updated_at)
    from public.products p
    join public.measurement_units u on u.id = p.unit_id
    left join public.product_categories cat on cat.id = p.category_id
    left join public.stock_balances b on b.company_id = p.company_id and b.product_id = p.id
   where p.company_id = private.store_company_id() and p.slug = p_slug and p.status = 'active' and p.show_in_store;
$$;

-- Cotação do carrinho: preço e disponibilidade atuais dos itens informados.
create or replace function public.store_quote(p_product_ids uuid[])
returns table (id uuid, slug text, name text, price numeric, image_path text, available numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.slug, p.name, p.sale_price, private.store_main_image(p.id),
         greatest(coalesce(b.quantity - b.reserved_quantity, 0), 0)
    from public.products p
    left join public.stock_balances b on b.company_id = p.company_id and b.product_id = p.id
   where p.company_id = private.store_company_id() and p.status = 'active' and p.show_in_store
     and p.id = any (p_product_ids[1:100]);
$$;

-- Acompanhamento do pedido pelo link secreto (sem dados pessoais).
create or replace function public.store_order(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'number', o.number, 'status', o.status, 'created_at', o.created_at, 'paid_at', o.paid_at,
           'subtotal', o.subtotal, 'shipping', o.shipping, 'discount', o.discount, 'total', o.total,
           'delivery_method', o.delivery_method, 'reserved_until', o.reserved_until,
           'items', (select jsonb_agg(jsonb_build_object('name', p.name, 'quantity', i.quantity, 'unit_price', i.unit_price,
                                                         'total', i.total, 'unit', u.code) order by i.sort_order)
                       from public.order_items i
                       join public.products p on p.id = i.product_id
                       join public.measurement_units u on u.id = p.unit_id
                      where i.order_id = o.id))
    from public.orders o
   where o.public_token = p_token and o.channel = 'loja' and o.company_id = private.store_company_id();
$$;

revoke execute on function public.store_settings(), public.store_categories(), public.store_products(uuid, text, int, int),
  public.store_product(text), public.store_quote(uuid[]), public.store_order(uuid) from public;
grant execute on function public.store_settings(), public.store_categories(), public.store_products(uuid, text, int, int),
  public.store_product(text), public.store_quote(uuid[]), public.store_order(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Checkout da loja (somente o servidor, com a chave secreta)
--   p_customer: {name, email, phone, document?}
--   p_items: [{product_id, quantity}]
--   p_delivery: {method: 'retirada'|'entrega', postal_code, street, address_number, complement, district, city, state}
--   p_consents: {whatsapp: bool, marketing: bool}
-- ---------------------------------------------------------------------
create or replace function public.fn_store_checkout(
  p_idempotency_key text,
  p_customer        jsonb,
  p_items           jsonb,
  p_delivery        jsonb,
  p_consents        jsonb,
  p_notes           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.store_company_id();
  v_cfg jsonb;
  v_existing public.orders;
  v_name text := btrim(p_customer ->> 'name');
  v_email text := lower(btrim(p_customer ->> 'email'));
  v_phone text := regexp_replace(coalesce(p_customer ->> 'phone', ''), '\D', '', 'g');
  v_document text := nullif(regexp_replace(coalesce(p_customer ->> 'document', ''), '\D', '', 'g'), '');
  v_method text := p_delivery ->> 'method';
  v_address jsonb;
  v_shipping numeric := 0;
  v_customer uuid;
  v_order public.orders;
  v_wa boolean := coalesce((p_consents ->> 'whatsapp')::boolean, false);
  v_mk boolean := coalesce((p_consents ->> 'marketing')::boolean, false);
begin
  if v_company is null then
    raise exception 'Loja indisponível' using errcode = 'P0001';
  end if;
  v_cfg := private.store_config(v_company);
  if not coalesce((v_cfg ->> 'enabled')::boolean, false) then
    raise exception 'A loja não está recebendo pedidos no momento' using errcode = 'P0001';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'Requisição inválida' using errcode = 'P0001';
  end if;

  -- mesma tentativa reenviada (inclusive simultânea): devolve o pedido já criado
  perform pg_advisory_xact_lock(hashtext('kairos.checkout.' || p_idempotency_key));
  select * into v_existing from public.orders where company_id = v_company and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object('order_id', v_existing.id, 'number', v_existing.number, 'public_token', v_existing.public_token,
                              'total', v_existing.total, 'duplicate', true);
  end if;

  if v_name is null or char_length(v_name) not between 2 and 160 then
    raise exception 'Informe seu nome' using errcode = 'P0001';
  end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_email) > 254 then
    raise exception 'E-mail inválido' using errcode = 'P0001';
  end if;
  if v_phone !~ '^[0-9]{10,13}$' then
    raise exception 'Telefone/WhatsApp com DDD' using errcode = 'P0001';
  end if;
  if v_document is not null and v_document !~ '^([0-9]{11}|[0-9]{14})$' then
    raise exception 'CPF/CNPJ inválido' using errcode = 'P0001';
  end if;

  if v_method = 'retirada' then
    if not coalesce((v_cfg ->> 'pickup_enabled')::boolean, false) then
      raise exception 'Retirada indisponível' using errcode = 'P0001';
    end if;
  elsif v_method = 'entrega' then
    if not coalesce((v_cfg ->> 'delivery_enabled')::boolean, false) then
      raise exception 'Entrega indisponível' using errcode = 'P0001';
    end if;
    if coalesce(p_delivery ->> 'postal_code', '') !~ '^[0-9]{8}$' or coalesce(btrim(p_delivery ->> 'street'), '') = ''
       or coalesce(btrim(p_delivery ->> 'address_number'), '') = '' or coalesce(btrim(p_delivery ->> 'district'), '') = ''
       or coalesce(btrim(p_delivery ->> 'city'), '') = '' or coalesce(p_delivery ->> 'state', '') !~ '^[A-Z]{2}$' then
      raise exception 'Endereço de entrega incompleto' using errcode = 'P0001';
    end if;
    v_address := jsonb_build_object(
      'postal_code', p_delivery ->> 'postal_code', 'street', left(btrim(p_delivery ->> 'street'), 160),
      'address_number', left(btrim(p_delivery ->> 'address_number'), 20), 'complement', left(nullif(btrim(p_delivery ->> 'complement'), ''), 80),
      'district', left(btrim(p_delivery ->> 'district'), 80), 'city', left(btrim(p_delivery ->> 'city'), 80), 'state', p_delivery ->> 'state');
    v_shipping := coalesce((v_cfg ->> 'delivery_fee')::numeric, 0);
  else
    raise exception 'Escolha retirada ou entrega' using errcode = 'P0001';
  end if;

  -- cliente: reaproveita pelo documento ou e-mail; nunca apaga dados nem revoga consentimento pela loja
  select id into v_customer from public.customers
   where company_id = v_company and anonymized_at is null
     and ((v_document is not null and document = v_document) or lower(email) = v_email)
   order by (v_document is not null and document = v_document) desc, created_at
   limit 1;

  perform set_config('kairos.consent_source', 'loja', true);
  if v_customer is null then
    insert into public.customers (company_id, name, email, phone, document, postal_code, street, address_number, complement,
                                  district, city, state, whatsapp_opt_in, marketing_opt_in)
    values (v_company, v_name, v_email, v_phone, v_document, v_address ->> 'postal_code', v_address ->> 'street',
            v_address ->> 'address_number', v_address ->> 'complement', v_address ->> 'district', v_address ->> 'city',
            v_address ->> 'state', v_wa, v_mk)
    returning id into v_customer;
  else
    update public.customers
       set phone = coalesce(phone, v_phone),
           email = coalesce(email, v_email),
           document = coalesce(document, v_document),
           postal_code = coalesce(postal_code, v_address ->> 'postal_code'),
           street = coalesce(street, v_address ->> 'street'),
           address_number = coalesce(address_number, v_address ->> 'address_number'),
           complement = coalesce(complement, v_address ->> 'complement'),
           district = coalesce(district, v_address ->> 'district'),
           city = coalesce(city, v_address ->> 'city'),
           state = coalesce(state, v_address ->> 'state'),
           whatsapp_opt_in = whatsapp_opt_in or v_wa,
           marketing_opt_in = marketing_opt_in or v_mk,
           status = 'active'
     where id = v_customer;
  end if;
  perform set_config('kairos.consent_source', '', true);

  v_order := private.create_order(
    v_company, 'loja', v_customer, p_items, 0, v_shipping,
    (now() at time zone 'America/Sao_Paulo')::date, left(nullif(btrim(p_notes), ''), 1000),
    now() + make_interval(hours => greatest(coalesce((v_cfg ->> 'reservation_hours')::int, 48), 1)),
    v_method, v_address, p_idempotency_key, true
  );

  return jsonb_build_object('order_id', v_order.id, 'number', v_order.number, 'public_token', v_order.public_token,
                            'total', v_order.total, 'reserved_until', v_order.reserved_until);
end;
$$;
revoke execute on function public.fn_store_checkout(text, jsonb, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.fn_store_checkout(text, jsonb, jsonb, jsonb, jsonb, text) to service_role;

-- ---------------------------------------------------------------------
-- LGPD: anonimizar o cliente também remove o endereço de entrega dos pedidos
-- ---------------------------------------------------------------------
create or replace function public.fn_anonymize_customer(p_customer_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Informe o motivo (ex.: solicitação do titular)' using errcode = 'P0001';
  end if;
  select * into v_customer from public.customers where id = p_customer_id for update;
  if v_customer.id is null or not private.has_company_role(v_customer.company_id, array['owner', 'admin']) then
    raise exception 'Cliente não encontrado ou sem permissão' using errcode = '42501';
  end if;
  if v_customer.anonymized_at is not null then
    raise exception 'Cliente já anonimizado' using errcode = 'P0001';
  end if;

  perform set_config('kairos.consent_source', 'anonimizacao', true);
  perform set_config('kairos.anonymizing', 'on', true);
  update public.customers
     set name = 'Cliente anonimizado', document = null, email = null, phone = null, birth_date = null,
         postal_code = null, street = null, address_number = null, complement = null, district = null,
         city = null, state = null, notes = null, marketing_opt_in = false, whatsapp_opt_in = false,
         status = 'inactive'
   where id = p_customer_id;
  perform set_config('kairos.anonymizing', '', true);
  perform set_config('kairos.consent_source', '', true);

  update public.orders set delivery_address = null, notes = case when channel = 'loja' then null else notes end
   where customer_id = p_customer_id;

  insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
  values (v_customer.company_id, (select auth.uid()), 'anonymize', 'customers', p_customer_id::text,
          jsonb_build_object('reason', btrim(p_reason)));
end;
$$;
