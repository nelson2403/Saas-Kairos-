-- =====================================================================
-- SAS KAIRÓS — Fase 4: clientes (LGPD), fornecedores, compras e recebimentos
--
-- Regras:
--  * Dados pessoais nunca vão para a auditoria em claro: o trigger mascara
--    os campos pessoais (registra só que mudaram).
--  * Consentimentos de marketing/WhatsApp ficam num histórico imutável
--    (quando, por quem, de onde). Cliente não é excluído: é anonimizado.
--  * Só o recebimento (fn_receive_purchase) gera entrada de estoque de compra,
--    na mesma transação, com custo convertido para a unidade de estoque.
--  * Estorno de recebimento devolve o estoque, uma única vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Auditoria com campos pessoais mascarados (nomes das colunas em TG_ARGV)
-- ---------------------------------------------------------------------
create or replace function private.audit_row_masked()
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
  v_masked text[] := tg_argv;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(
             n.key,
             case when n.key = any (v_masked) then '"alterado"'::jsonb
                  else jsonb_build_object('from', v_old -> n.key, 'to', n.value) end)
      into v_changes
      from jsonb_each(v_new) n
     where n.key <> all (v_ignored)
       and (v_old -> n.key) is distinct from n.value;
    if v_changes is null then
      return new;
    end if;
  else
    select jsonb_object_agg(
             e.key,
             case when e.key = any (v_masked) and e.value <> 'null'::jsonb then '"***"'::jsonb else e.value end)
      into v_changes
      from jsonb_each(coalesce(v_new, v_old) - v_ignored) e;
  end if;

  insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, changes)
  values ((v_row ->> 'company_id')::uuid, (select auth.uid()), lower(tg_op), tg_table_name, v_row ->> 'id', v_changes);
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------
create table public.customers (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  name                 text not null check (char_length(btrim(name)) between 2 and 160),
  document             text check (document is null or document ~ '^([0-9]{11}|[0-9]{14})$'),
  email                text check (email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  phone                text check (phone is null or phone ~ '^[0-9]{10,13}$'),
  birth_date           date check (birth_date is null or birth_date >= '1900-01-01'), -- data futura é recusada na aplicação (CHECK deve ser imutável)
  postal_code          text check (postal_code is null or postal_code ~ '^[0-9]{8}$'),
  street               text check (street is null or char_length(street) <= 160),
  address_number       text check (address_number is null or char_length(address_number) <= 20),
  complement           text check (complement is null or char_length(complement) <= 80),
  district             text check (district is null or char_length(district) <= 80),
  city                 text check (city is null or char_length(city) <= 80),
  state                text check (state is null or state ~ '^[A-Z]{2}$'),
  notes                text check (notes is null or char_length(notes) <= 2000),
  marketing_opt_in     boolean not null default false,
  marketing_opt_in_at  timestamptz,
  whatsapp_opt_in      boolean not null default false,
  whatsapp_opt_in_at   timestamptz,
  status               text not null default 'active' check (status in ('active', 'inactive')),
  anonymized_at        timestamptz,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (company_id, id)
);
create unique index customers_document_uq on public.customers (company_id, document) where document is not null;
create index customers_name_idx on public.customers (company_id, lower(name));

create trigger customers_updated_at before update on public.customers
  for each row execute function private.set_updated_at();

-- Histórico de consentimentos (prova de quando o cliente autorizou ou revogou).
create table public.customer_consents (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  customer_id  uuid not null,
  channel      text not null check (channel in ('marketing', 'whatsapp')),
  granted      boolean not null,
  source       text not null default 'painel' check (source in ('painel', 'loja', 'anonimizacao')),
  recorded_by  uuid,
  created_at   timestamptz not null default now(),
  foreign key (company_id, customer_id) references public.customers (company_id, id) on delete cascade
);
create index customer_consents_customer_idx on public.customer_consents (customer_id, created_at desc);

create trigger customer_consents_immutable before update or delete on public.customer_consents
  for each row execute function private.forbid_change();

-- Antes de gravar: carimba a data do consentimento; bloqueia edição de anonimizados.
create or replace function private.customer_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.anonymized_at is not null then
    raise exception 'Cliente anonimizado não pode ser alterado' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' or new.marketing_opt_in is distinct from old.marketing_opt_in then
    new.marketing_opt_in_at := case when new.marketing_opt_in then now() end;
  else
    new.marketing_opt_in_at := old.marketing_opt_in_at;
  end if;
  if tg_op = 'INSERT' or new.whatsapp_opt_in is distinct from old.whatsapp_opt_in then
    new.whatsapp_opt_in_at := case when new.whatsapp_opt_in then now() end;
  else
    new.whatsapp_opt_in_at := old.whatsapp_opt_in_at;
  end if;
  -- só a função de anonimização define a data (sinal na transação)
  new.anonymized_at := case
    when current_setting('kairos.anonymizing', true) = 'on' then now()
    when tg_op = 'UPDATE' then old.anonymized_at
  end;
  return new;
end;
$$;
create trigger customers_before_write before insert or update on public.customers
  for each row execute function private.customer_before_write();

-- Depois de gravar: registra cada mudança de consentimento.
create or replace function private.customer_log_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text := coalesce(nullif(current_setting('kairos.consent_source', true), ''), 'painel');
begin
  if (tg_op = 'INSERT' and new.marketing_opt_in) or (tg_op = 'UPDATE' and new.marketing_opt_in is distinct from old.marketing_opt_in) then
    insert into public.customer_consents (company_id, customer_id, channel, granted, source, recorded_by)
    values (new.company_id, new.id, 'marketing', new.marketing_opt_in, v_source, (select auth.uid()));
  end if;
  if (tg_op = 'INSERT' and new.whatsapp_opt_in) or (tg_op = 'UPDATE' and new.whatsapp_opt_in is distinct from old.whatsapp_opt_in) then
    insert into public.customer_consents (company_id, customer_id, channel, granted, source, recorded_by)
    values (new.company_id, new.id, 'whatsapp', new.whatsapp_opt_in, v_source, (select auth.uid()));
  end if;
  return new;
end;
$$;
create trigger customers_log_consent after insert or update on public.customers
  for each row execute function private.customer_log_consent();

create trigger customers_audit after insert or update on public.customers
  for each row execute function private.audit_row_masked(
    'name', 'document', 'email', 'phone', 'birth_date', 'postal_code', 'street', 'address_number',
    'complement', 'district', 'city', 'notes');

-- Anonimização (LGPD): remove os dados pessoais e mantém o registro para o histórico de vendas.
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

  insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
  values (v_customer.company_id, (select auth.uid()), 'anonymize', 'customers', p_customer_id::text,
          jsonb_build_object('reason', btrim(p_reason)));
end;
$$;
revoke execute on function public.fn_anonymize_customer(uuid, text) from public, anon;
grant execute on function public.fn_anonymize_customer(uuid, text) to authenticated;

-- Registra na auditoria cada exportação de dados pessoais (quem e quando).
create or replace function public.fn_log_customer_export(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.customers where id = p_customer_id;
  if v_company is null or not private.has_company_role(v_company, array['owner', 'admin']) then
    raise exception 'Cliente não encontrado ou sem permissão' using errcode = '42501';
  end if;
  insert into public.audit_logs (company_id, actor_id, action, entity, entity_id)
  values (v_company, (select auth.uid()), 'export', 'customers', p_customer_id::text);
end;
$$;
revoke execute on function public.fn_log_customer_export(uuid) from public, anon;
grant execute on function public.fn_log_customer_export(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Fornecedores
-- ---------------------------------------------------------------------
create table public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 2 and 160),
  trade_name      text check (trade_name is null or char_length(trade_name) <= 160),
  document        text check (document is null or document ~ '^([0-9]{11}|[0-9]{14})$'),
  email           text check (email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  phone           text check (phone is null or phone ~ '^[0-9]{10,13}$'),
  contact_name    text check (contact_name is null or char_length(contact_name) <= 120),
  postal_code     text check (postal_code is null or postal_code ~ '^[0-9]{8}$'),
  street          text check (street is null or char_length(street) <= 160),
  address_number  text check (address_number is null or char_length(address_number) <= 20),
  complement      text check (complement is null or char_length(complement) <= 80),
  district        text check (district is null or char_length(district) <= 80),
  city            text check (city is null or char_length(city) <= 80),
  state           text check (state is null or state ~ '^[A-Z]{2}$'),
  notes           text check (notes is null or char_length(notes) <= 2000),
  status          text not null default 'active' check (status in ('active', 'inactive')),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, id)
);
create unique index suppliers_document_uq on public.suppliers (company_id, document) where document is not null;
create index suppliers_name_idx on public.suppliers (company_id, lower(name));

create trigger suppliers_updated_at before update on public.suppliers
  for each row execute function private.set_updated_at();
-- fornecedor pode ser pessoa física: documento e contatos mascarados
create trigger suppliers_audit after insert or update on public.suppliers
  for each row execute function private.audit_row_masked('document', 'email', 'phone', 'contact_name');

alter table public.raw_materials add column preferred_supplier_id uuid;
alter table public.raw_materials
  add constraint raw_materials_preferred_supplier_fk foreign key (company_id, preferred_supplier_id)
  references public.suppliers (company_id, id) on delete set null (preferred_supplier_id);

-- ---------------------------------------------------------------------
-- Pedidos de compra
-- ---------------------------------------------------------------------
create table public.purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  number         bigint not null,
  supplier_id    uuid not null,
  status         text not null default 'draft'
                 check (status in ('draft', 'ordered', 'partial', 'received', 'closed', 'canceled')),
  expected_date  date,
  notes          text check (notes is null or char_length(notes) <= 2000),
  total          numeric(14, 2) not null default 0 check (total >= 0),
  close_reason   text check (close_reason is null or char_length(close_reason) <= 300),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  ordered_at     timestamptz,
  closed_by      uuid,
  closed_at      timestamptz,
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, supplier_id) references public.suppliers (company_id, id)
);
create index purchase_orders_company_idx on public.purchase_orders (company_id, number desc);
create index purchase_orders_supplier_idx on public.purchase_orders (supplier_id, created_at desc);

create trigger purchase_orders_updated_at before update on public.purchase_orders
  for each row execute function private.set_updated_at();

create table public.purchase_order_items (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null,
  order_id           uuid not null,
  product_id         uuid,
  raw_material_id    uuid,
  quantity           numeric(18, 6) not null check (quantity > 0),           -- na unidade de compra
  unit_id            uuid not null references public.measurement_units (id), -- unidade de compra
  unit_price         numeric(18, 6) not null check (unit_price >= 0),        -- por unidade de compra
  received_quantity  numeric(18, 6) not null default 0 check (received_quantity >= 0),
  sort_order         int not null default 0,
  check (num_nonnulls(product_id, raw_material_id) = 1),
  check (received_quantity <= quantity),
  foreign key (company_id, order_id) references public.purchase_orders (company_id, id) on delete cascade,
  foreign key (company_id, product_id) references public.products (company_id, id),
  foreign key (company_id, raw_material_id) references public.raw_materials (company_id, id),
  unique (order_id, product_id),
  unique (order_id, raw_material_id)
);

create table public.purchase_receipts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  order_id        uuid not null,
  invoice_number  text check (invoice_number is null or char_length(invoice_number) <= 60),
  notes           text check (notes is null or char_length(notes) <= 2000),
  status          text not null default 'active' check (status in ('active', 'reversed')),
  reverse_reason  text check (reverse_reason is null or char_length(reverse_reason) <= 300),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  reversed_by     uuid,
  reversed_at     timestamptz,
  unique (company_id, id),
  foreign key (company_id, order_id) references public.purchase_orders (company_id, id)
);
create index purchase_receipts_order_idx on public.purchase_receipts (order_id, created_at);

create table public.purchase_receipt_items (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  receipt_id      uuid not null,
  order_item_id   uuid not null references public.purchase_order_items (id),
  quantity        numeric(18, 6) not null check (quantity > 0),   -- unidade de compra
  unit_price      numeric(18, 6) not null check (unit_price >= 0),
  movement_id     uuid not null references public.stock_movements (id),
  foreign key (company_id, receipt_id) references public.purchase_receipts (company_id, id) on delete cascade
);

-- Total do pedido (centavos arredondados por linha).
create or replace function private.purchase_order_total(p_order_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(round(quantity * unit_price, 2)), 0) from public.purchase_order_items where order_id = p_order_id;
$$;

-- Status conforme o recebido (preserva encerrado/cancelado).
create or replace function private.refresh_purchase_status(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
  v_received numeric;
  v_pending int;
  v_status text;
begin
  select * into v_order from public.purchase_orders where id = p_order_id;
  if v_order.status in ('closed', 'canceled') then
    return v_order.status;
  end if;
  select coalesce(sum(received_quantity), 0), count(*) filter (where received_quantity < quantity)
    into v_received, v_pending
    from public.purchase_order_items where order_id = p_order_id;
  v_status := case
    when v_received = 0 then case when v_order.ordered_at is null then 'draft' else 'ordered' end
    when v_pending = 0 then 'received'
    else 'partial'
  end;
  update public.purchase_orders set status = v_status where id = p_order_id and status <> v_status;
  return v_status;
end;
$$;
revoke execute on function private.refresh_purchase_status(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- API: criar/editar pedido de compra (só enquanto nada foi recebido)
--   p_items: [{"item_type": "product"|"raw_material", "item_id": uuid,
--              "quantity": n, "unit_id": uuid, "unit_price": n}, …]
-- ---------------------------------------------------------------------
create or replace function public.fn_save_purchase_order(
  p_client_op_id   uuid,
  p_order_id       uuid,
  p_supplier_id    uuid,
  p_expected_date  date,
  p_notes          text,
  p_items          jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.current_company_id();
  v_supplier public.suppliers;
  v_order public.purchase_orders;
  v_existing jsonb;
  v_item jsonb;
  v_type text;
  v_id uuid;
  v_name text;
  v_stock_unit uuid;
  v_density numeric;
  v_status text;
  v_qty numeric;
  v_price numeric;
  v_unit uuid;
  v_seen text[] := '{}';
  v_order_no int := 0;
  v_result jsonb;
begin
  if v_company is null or not private.has_company_role(v_company, array['owner', 'admin', 'manager']) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;

  v_existing := private.claim_client_op(v_company, p_client_op_id);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_supplier from public.suppliers where id = p_supplier_id and company_id = v_company;
  if v_supplier.id is null then
    raise exception 'Selecione o fornecedor' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Inclua ao menos um item' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Pedido com itens demais (máximo 200)' using errcode = 'P0001';
  end if;

  if p_order_id is null then
    if v_supplier.status <> 'active' then
      raise exception 'Fornecedor inativo' using errcode = 'P0001';
    end if;
    insert into public.purchase_orders (company_id, number, supplier_id, expected_date, notes, created_by)
    values (v_company, private.next_document_number(v_company, 'purchase_order'), p_supplier_id, p_expected_date,
            nullif(btrim(p_notes), ''), (select auth.uid()))
    returning * into v_order;
  else
    select * into v_order from public.purchase_orders where id = p_order_id and company_id = v_company for update;
    if v_order.id is null then
      raise exception 'Pedido não encontrado' using errcode = '42501';
    end if;
    if v_order.status not in ('draft', 'ordered')
       or exists (select 1 from public.purchase_receipts where order_id = p_order_id) then
      raise exception 'Pedido com recebimento ou encerrado não pode ser alterado' using errcode = 'P0002';
    end if;
    update public.purchase_orders
       set supplier_id = p_supplier_id, expected_date = p_expected_date, notes = nullif(btrim(p_notes), '')
     where id = p_order_id;
    delete from public.purchase_order_items where order_id = p_order_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_type := v_item ->> 'item_type';
    v_id := (v_item ->> 'item_id')::uuid;
    if v_type = 'product' then
      select name, unit_id, null, status into v_name, v_stock_unit, v_density, v_status
        from public.products where id = v_id and company_id = v_company;
    elsif v_type = 'raw_material' then
      select name, unit_id, density, status into v_name, v_stock_unit, v_density, v_status
        from public.raw_materials where id = v_id and company_id = v_company;
    else
      raise exception 'Tipo de item inválido' using errcode = 'P0001';
    end if;
    if v_name is null then
      raise exception 'Item não encontrado' using errcode = 'P0001';
    end if;
    if v_status = 'archived' then
      raise exception '"%" está arquivado', v_name using errcode = 'P0001';
    end if;
    if (v_type || v_id::text) = any (v_seen) then
      raise exception '"%" aparece mais de uma vez', v_name using errcode = 'P0001';
    end if;
    v_seen := v_seen || (v_type || v_id::text);

    v_qty := (v_item ->> 'quantity')::numeric;
    v_price := coalesce((v_item ->> 'unit_price')::numeric, 0);
    v_unit := coalesce((v_item ->> 'unit_id')::uuid, v_stock_unit);
    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantidade inválida para "%"', v_name using errcode = 'P0001';
    end if;
    if v_price < 0 then
      raise exception 'Preço inválido para "%"', v_name using errcode = 'P0001';
    end if;
    perform private.convert_quantity(v_qty, v_unit, v_stock_unit, v_density);

    insert into public.purchase_order_items (company_id, order_id, product_id, raw_material_id, quantity, unit_id, unit_price, sort_order)
    values (v_company, v_order.id,
            case when v_type = 'product' then v_id end,
            case when v_type = 'raw_material' then v_id end,
            v_qty, v_unit, v_price, v_order_no);
    v_order_no := v_order_no + 1;
  end loop;

  update public.purchase_orders set total = private.purchase_order_total(v_order.id) where id = v_order.id;

  v_result := jsonb_build_object('order_id', v_order.id, 'number', v_order.number);
  perform private.record_client_op(v_company, p_client_op_id, 'purchase.save', v_result);
  return v_result;
end;
$$;
revoke execute on function public.fn_save_purchase_order(uuid, uuid, uuid, date, text, jsonb) from public, anon;
grant execute on function public.fn_save_purchase_order(uuid, uuid, uuid, date, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- API: mudar situação do pedido
--   ordered  : marcar como enviado ao fornecedor (de rascunho)
--   canceled : cancelar (sem nenhum recebimento ativo)
--   closed   : encerrar com saldo pendente (já recebido em parte)
-- ---------------------------------------------------------------------
create or replace function public.fn_set_purchase_order_status(p_order_id uuid, p_status text, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
begin
  select * into v_order from public.purchase_orders where id = p_order_id for update;
  if v_order.id is null or not private.has_company_role(v_order.company_id, array['owner', 'admin', 'manager']) then
    raise exception 'Pedido não encontrado ou sem permissão' using errcode = '42501';
  end if;

  if p_status = 'ordered' then
    if v_order.status <> 'draft' then
      raise exception 'Somente rascunhos podem ser marcados como enviados' using errcode = 'P0001';
    end if;
    update public.purchase_orders set status = 'ordered', ordered_at = now() where id = p_order_id;
  elsif p_status = 'canceled' then
    if v_order.status not in ('draft', 'ordered')
       or exists (select 1 from public.purchase_order_items where order_id = p_order_id and received_quantity > 0) then
      raise exception 'Pedido com recebimento não pode ser cancelado; estorne os recebimentos ou encerre o saldo'
        using errcode = 'P0001';
    end if;
    update public.purchase_orders
       set status = 'canceled', close_reason = nullif(btrim(p_reason), ''), closed_by = (select auth.uid()), closed_at = now()
     where id = p_order_id;
  elsif p_status = 'closed' then
    if v_order.status <> 'partial' then
      raise exception 'Somente pedidos recebidos em parte podem ser encerrados' using errcode = 'P0001';
    end if;
    update public.purchase_orders
       set status = 'closed', close_reason = nullif(btrim(p_reason), ''), closed_by = (select auth.uid()), closed_at = now()
     where id = p_order_id;
  else
    raise exception 'Situação inválida' using errcode = 'P0001';
  end if;
  return p_status;
end;
$$;
revoke execute on function public.fn_set_purchase_order_status(uuid, text, text) from public, anon;
grant execute on function public.fn_set_purchase_order_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- API: receber mercadoria (gera entrada de estoque "compra")
--   p_items: [{"order_item_id": uuid, "quantity": n, "unit_price": n?}, …]
--   quantidade e preço na unidade de compra do item.
-- ---------------------------------------------------------------------
create or replace function public.fn_receive_purchase(
  p_client_op_id    uuid,
  p_order_id        uuid,
  p_items           jsonb,
  p_invoice_number  text default null,
  p_notes           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
  v_existing jsonb;
  v_receipt uuid;
  v_line record;
  v_qty numeric;
  v_price numeric;
  v_stock_qty numeric;
  v_cost numeric;
  v_mov public.stock_movements;
  v_count int := 0;
  v_status text;
  v_result jsonb;
begin
  select * into v_order from public.purchase_orders where id = p_order_id for update;
  if v_order.id is null or not private.has_company_role(v_order.company_id, array['owner', 'admin', 'manager', 'operator']) then
    raise exception 'Pedido não encontrado ou sem permissão' using errcode = '42501';
  end if;

  v_existing := private.claim_client_op(v_order.company_id, p_client_op_id);
  if v_existing is not null then
    return v_existing;
  end if;

  if v_order.status not in ('draft', 'ordered', 'partial') then
    raise exception 'Pedido % não aceita recebimento (situação: %)', v_order.number, v_order.status using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Informe ao menos um item recebido' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
     where not exists (select 1 from public.purchase_order_items i
                        where i.order_id = p_order_id and i.id = (e ->> 'order_item_id')::uuid)
  ) then
    raise exception 'Item não pertence a este pedido' using errcode = 'P0001';
  end if;
  if (select count(distinct e ->> 'order_item_id') from jsonb_array_elements(p_items) e) <> jsonb_array_length(p_items) then
    raise exception 'Item repetido no recebimento' using errcode = 'P0001';
  end if;

  insert into public.purchase_receipts (company_id, order_id, invoice_number, notes, created_by)
  values (v_order.company_id, p_order_id, nullif(btrim(p_invoice_number), ''), nullif(btrim(p_notes), ''), (select auth.uid()))
  returning id into v_receipt;

  -- Ordem fixa de travamento (id do item de estoque).
  for v_line in
    select i.*, (e ->> 'quantity')::numeric as recv_qty, (e ->> 'unit_price')::numeric as recv_price,
           coalesce(p.name, r.name) as item_name,
           coalesce(p.unit_id, r.unit_id) as stock_unit,
           r.density
      from jsonb_array_elements(p_items) e
      join public.purchase_order_items i on i.id = (e ->> 'order_item_id')::uuid
      left join public.products p on p.id = i.product_id
      left join public.raw_materials r on r.id = i.raw_material_id
     order by coalesce(i.product_id, i.raw_material_id)
  loop
    v_qty := v_line.recv_qty;
    if v_qty is null or v_qty <= 0 then
      continue; -- linha sem quantidade: não recebida agora
    end if;
    if v_line.received_quantity + v_qty > v_line.quantity then
      raise exception 'Quantidade de "%" acima do pendente (pendente: %)', v_line.item_name,
        trim_scale(v_line.quantity - v_line.received_quantity) using errcode = 'P0001';
    end if;
    v_price := coalesce(v_line.recv_price, v_line.unit_price);
    if v_price < 0 then
      raise exception 'Preço inválido para "%"', v_line.item_name using errcode = 'P0001';
    end if;

    v_stock_qty := private.convert_quantity(v_qty, v_line.unit_id, v_line.stock_unit, v_line.density);
    if v_stock_qty <= 0 then
      raise exception 'Quantidade de "%" pequena demais para a unidade de estoque', v_line.item_name using errcode = 'P0001';
    end if;
    v_cost := round(v_price * v_qty / v_stock_qty, 6); -- por unidade de estoque

    v_mov := private.apply_stock_movement(
      v_order.company_id,
      case when v_line.product_id is not null then 'product' else 'raw_material' end,
      coalesce(v_line.product_id, v_line.raw_material_id),
      'compra', v_stock_qty, v_qty, v_line.unit_id, v_cost, null, 'PC ' || v_order.number,
      'purchase_receipt', v_receipt
    );

    insert into public.purchase_receipt_items (company_id, receipt_id, order_item_id, quantity, unit_price, movement_id)
    values (v_order.company_id, v_receipt, v_line.id, v_qty, v_price, v_mov.id);
    update public.purchase_order_items set received_quantity = received_quantity + v_qty where id = v_line.id;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'Informe a quantidade recebida de ao menos um item' using errcode = 'P0001';
  end if;

  v_status := private.refresh_purchase_status(p_order_id);
  v_result := jsonb_build_object('receipt_id', v_receipt, 'order_id', p_order_id, 'status', v_status, 'items', v_count);
  perform private.record_client_op(v_order.company_id, p_client_op_id, 'purchase.receive', v_result);
  return v_result;
end;
$$;
revoke execute on function public.fn_receive_purchase(uuid, uuid, jsonb, text, text) from public, anon;
grant execute on function public.fn_receive_purchase(uuid, uuid, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- API: estornar recebimento (retira do estoque o que entrou; uma vez)
-- ---------------------------------------------------------------------
create or replace function public.fn_reverse_purchase_receipt(p_client_op_id uuid, p_receipt_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.purchase_receipts;
  v_order public.purchase_orders;
  v_existing jsonb;
  v_line record;
  v_status text;
  v_result jsonb;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Informe o motivo do estorno' using errcode = 'P0001';
  end if;
  select * into v_receipt from public.purchase_receipts where id = p_receipt_id;
  if v_receipt.id is null or not private.has_company_role(v_receipt.company_id, array['owner', 'admin', 'manager']) then
    raise exception 'Recebimento não encontrado ou sem permissão' using errcode = '42501';
  end if;
  -- trava o pedido (mesma ordem de travamento do recebimento) e depois o recebimento
  select * into v_order from public.purchase_orders where id = v_receipt.order_id for update;
  select * into v_receipt from public.purchase_receipts where id = p_receipt_id for update;

  v_existing := private.claim_client_op(v_receipt.company_id, p_client_op_id);
  if v_existing is not null then
    return v_existing;
  end if;
  if v_receipt.status <> 'active' then
    raise exception 'Recebimento já estornado' using errcode = 'P0002';
  end if;

  for v_line in
    select ri.order_item_id, m.id as movement_id, m.product_id, m.raw_material_id,
           m.quantity, m.input_quantity, m.input_unit_id
      from public.purchase_receipt_items ri
      join public.stock_movements m on m.id = ri.movement_id
     where ri.receipt_id = p_receipt_id
     order by coalesce(m.product_id, m.raw_material_id)
  loop
    perform private.apply_stock_movement(
      v_receipt.company_id,
      case when v_line.product_id is not null then 'product' else 'raw_material' end,
      coalesce(v_line.product_id, v_line.raw_material_id),
      'estorno', -v_line.quantity, -v_line.input_quantity, v_line.input_unit_id,
      null, p_reason, 'PC ' || v_order.number, 'purchase_receipt', p_receipt_id, v_line.movement_id
    );
    update public.purchase_order_items set received_quantity = received_quantity - v_line.input_quantity
     where id = v_line.order_item_id;
  end loop;

  update public.purchase_receipts
     set status = 'reversed', reverse_reason = btrim(p_reason), reversed_by = (select auth.uid()), reversed_at = now()
   where id = p_receipt_id;

  v_status := private.refresh_purchase_status(v_receipt.order_id);
  v_result := jsonb_build_object('receipt_id', p_receipt_id, 'order_id', v_receipt.order_id, 'status', v_status);
  perform private.record_client_op(v_receipt.company_id, p_client_op_id, 'purchase.reverse', v_result);
  return v_result;
end;
$$;
revoke execute on function public.fn_reverse_purchase_receipt(uuid, uuid, text) from public, anon;
grant execute on function public.fn_reverse_purchase_receipt(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
create trigger purchase_orders_audit after insert or update on public.purchase_orders
  for each row execute function private.audit_row();
create trigger purchase_receipts_audit after insert or update on public.purchase_receipts
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.customers               enable row level security;
alter table public.customer_consents       enable row level security;
alter table public.suppliers               enable row level security;
alter table public.purchase_orders         enable row level security;
alter table public.purchase_order_items    enable row level security;
alter table public.purchase_receipts       enable row level security;
alter table public.purchase_receipt_items  enable row level security;

-- clientes: membros leem; quem atende (operador+) cadastra e edita; ninguém exclui (anonimizar)
create policy customers_select on public.customers for select to authenticated
  using (private.is_company_member(company_id));
create policy customers_insert on public.customers for insert to authenticated
  with check (private.has_company_role(company_id, array['owner', 'admin', 'manager', 'operator']));
create policy customers_update on public.customers for update to authenticated
  using (private.has_company_role(company_id, array['owner', 'admin', 'manager', 'operator']))
  with check (private.has_company_role(company_id, array['owner', 'admin', 'manager', 'operator']));
revoke delete, truncate on public.customers from anon, authenticated;

create policy customer_consents_select on public.customer_consents for select to authenticated
  using (private.is_company_member(company_id));
revoke insert, update, delete, truncate on public.customer_consents from anon, authenticated;

-- fornecedores: membros leem; gerente+ edita
create policy suppliers_select on public.suppliers for select to authenticated
  using (private.is_company_member(company_id));
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check (private.has_company_role(company_id, array['owner', 'admin', 'manager']));
create policy suppliers_update on public.suppliers for update to authenticated
  using (private.has_company_role(company_id, array['owner', 'admin', 'manager']))
  with check (private.has_company_role(company_id, array['owner', 'admin', 'manager']));
revoke delete, truncate on public.suppliers from anon, authenticated;

-- compras: leitura para membros; escrita somente pelas funções
create policy purchase_orders_select on public.purchase_orders for select to authenticated
  using (private.is_company_member(company_id));
create policy purchase_order_items_select on public.purchase_order_items for select to authenticated
  using (private.is_company_member(company_id));
create policy purchase_receipts_select on public.purchase_receipts for select to authenticated
  using (private.is_company_member(company_id));
create policy purchase_receipt_items_select on public.purchase_receipt_items for select to authenticated
  using (private.is_company_member(company_id));
revoke insert, update, delete, truncate on
  public.purchase_orders, public.purchase_order_items, public.purchase_receipts, public.purchase_receipt_items
  from anon, authenticated;

revoke insert, update, delete, truncate on public.customers, public.suppliers from anon;
