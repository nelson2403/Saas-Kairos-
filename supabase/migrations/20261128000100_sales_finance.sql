-- =====================================================================
-- SAS KAIRÓS — Fase 5: pedidos, vendas, reservas e financeiro
--
-- Regras:
--  * Pedido criado = estoque RESERVADO (não baixado) + conta a receber aberta.
--  * Venda efetivada só quando o pagamento é registrado no servidor:
--    baixa o estoque (consome a reserva), registra o pagamento e liquida a
--    conta a receber, tudo na mesma transação.
--  * Estoque reservado não pode ser consumido por saídas manuais.
--  * Faturamento = pedidos pagos (data do pagamento). Fluxo de caixa =
--    lançamentos financeiros liquidados (data da liquidação).
--  * Dinheiro em numeric(14,2). Tabelas sem escrita direta pela API.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Núcleo do estoque: saídas não podem consumir o que está reservado
-- (ajuste continua livre: representa a contagem física).
-- ---------------------------------------------------------------------
create or replace function private.apply_stock_movement(
  p_company_id      uuid,
  p_item_type       text,
  p_item_id         uuid,
  p_type            text,
  p_delta           numeric,
  p_input_quantity  numeric,
  p_input_unit_id   uuid,
  p_unit_cost       numeric,
  p_reason          text,
  p_notes           text,
  p_source_type     text default null,
  p_source_id       uuid default null,
  p_reversal_of     uuid default null,
  p_client_op_id    uuid default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance public.stock_balances;
  v_allow_negative boolean;
  v_after numeric;
  v_avg numeric;
  v_mov public.stock_movements;
begin
  if p_delta = 0 then
    raise exception 'Quantidade não pode ser zero' using errcode = 'P0001';
  end if;

  if p_item_type = 'product' then
    insert into public.stock_balances (company_id, product_id) values (p_company_id, p_item_id)
      on conflict (company_id, product_id) where product_id is not null do nothing;
    select * into v_balance from public.stock_balances
      where company_id = p_company_id and product_id = p_item_id for update;
  else
    insert into public.stock_balances (company_id, raw_material_id) values (p_company_id, p_item_id)
      on conflict (company_id, raw_material_id) where raw_material_id is not null do nothing;
    select * into v_balance from public.stock_balances
      where company_id = p_company_id and raw_material_id = p_item_id for update;
  end if;

  v_after := v_balance.quantity + p_delta;

  select coalesce((c.settings ->> 'allow_negative_stock')::boolean, false)
    into v_allow_negative from public.companies c where c.id = p_company_id;

  if p_delta < 0 and v_after < 0 and not v_allow_negative then
    raise exception 'Saldo insuficiente: disponível %, solicitado %',
      trim_scale(v_balance.quantity - v_balance.reserved_quantity), trim_scale(-p_delta)
      using errcode = 'P0002', hint = 'stock_insufficient';
  end if;
  if p_delta < 0 and p_type <> 'ajuste' and v_balance.reserved_quantity > 0
     and v_after < v_balance.reserved_quantity and not v_allow_negative then
    raise exception 'Saldo disponível insuficiente: % reservado em pedidos, disponível %, solicitado %',
      trim_scale(v_balance.reserved_quantity), trim_scale(greatest(v_balance.quantity - v_balance.reserved_quantity, 0)),
      trim_scale(-p_delta)
      using errcode = 'P0002', hint = 'stock_reserved';
  end if;

  v_avg := v_balance.avg_cost;
  if p_delta > 0 and p_unit_cost is not null then
    v_avg := case
      when greatest(v_balance.quantity, 0) + p_delta = 0 then p_unit_cost
      else round((greatest(v_balance.quantity, 0) * v_balance.avg_cost + p_delta * p_unit_cost)
                 / (greatest(v_balance.quantity, 0) + p_delta), 6)
    end;
  end if;

  update public.stock_balances
     set quantity = v_after, avg_cost = v_avg, updated_at = now()
   where id = v_balance.id;

  insert into public.stock_movements (
    company_id, product_id, raw_material_id, type, quantity, input_quantity, input_unit_id,
    balance_before, balance_after, unit_cost, reason, notes, source_type, source_id,
    reversal_of, client_op_id, created_by
  ) values (
    p_company_id,
    case when p_item_type = 'product' then p_item_id end,
    case when p_item_type = 'raw_material' then p_item_id end,
    p_type, p_delta, p_input_quantity, p_input_unit_id,
    v_balance.quantity, v_after, p_unit_cost, nullif(btrim(p_reason), ''), nullif(btrim(p_notes), ''),
    p_source_type, p_source_id, p_reversal_of, p_client_op_id, (select auth.uid())
  )
  returning * into v_mov;

  if p_item_type = 'raw_material' and p_delta > 0 and p_unit_cost is not null then
    update public.raw_materials set last_cost = p_unit_cost where id = p_item_id;
  end if;

  return v_mov;
end;
$$;
revoke execute on function private.apply_stock_movement(uuid, text, uuid, text, numeric, numeric, uuid, numeric, text, text, text, uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Categorias financeiras (do sistema + personalizadas)
-- ---------------------------------------------------------------------
create table public.financial_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies (id) on delete cascade, -- null = do sistema
  key         text,                                                     -- categorias do sistema usadas pelas funções
  name        text not null check (char_length(btrim(name)) between 2 and 60),
  type        text not null check (type in ('income', 'expense')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique nulls not distinct (company_id, type, name)
);
create unique index financial_categories_key_uq on public.financial_categories (key) where key is not null;

insert into public.financial_categories (company_id, key, name, type) values
  (null, 'sales',          'Vendas',                     'income'),
  (null, 'other_income',   'Outras receitas',            'income'),
  (null, 'purchases',      'Compras (insumos e mercadorias)', 'expense'),
  (null, 'refunds',        'Estornos de vendas',         'expense'),
  (null, 'rent',           'Aluguel',                    'expense'),
  (null, 'payroll',        'Salários e pró-labore',      'expense'),
  (null, 'taxes',          'Impostos',                   'expense'),
  (null, 'fees',           'Taxas e tarifas',            'expense'),
  (null, 'shipping',       'Fretes e entregas',          'expense'),
  (null, 'marketing',      'Marketing',                  'expense'),
  (null, 'utilities',      'Água, luz e internet',       'expense'),
  (null, 'other_expense',  'Outras despesas',            'expense');

create or replace function private.category_id(p_key text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select id from public.financial_categories where key = p_key;
$$;

-- ---------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------
create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  number          bigint not null,
  channel         text not null default 'manual' check (channel in ('manual', 'loja')),
  customer_id     uuid,
  status          text not null default 'pending'
                  check (status in ('pending', 'paid', 'delivered', 'canceled', 'refunded')),
  subtotal        numeric(14, 2) not null check (subtotal >= 0),
  discount        numeric(14, 2) not null default 0 check (discount >= 0),
  shipping        numeric(14, 2) not null default 0 check (shipping >= 0),
  total           numeric(14, 2) not null check (total >= 0),
  due_date        date,
  notes           text check (notes is null or char_length(notes) <= 2000),
  close_reason    text check (close_reason is null or char_length(close_reason) <= 300),
  reserved_until  timestamptz, -- reservas com prazo (loja virtual); null = até pagar ou cancelar
  paid_at         timestamptz,
  delivered_at    timestamptz,
  closed_at       timestamptz,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  check (total = subtotal - discount + shipping),
  foreign key (company_id, customer_id) references public.customers (company_id, id)
);
create index orders_company_idx on public.orders (company_id, number desc);
create index orders_status_idx on public.orders (company_id, status);
create index orders_paid_idx on public.orders (company_id, paid_at) where paid_at is not null;
create index orders_customer_idx on public.orders (customer_id, created_at desc);

create trigger orders_updated_at before update on public.orders
  for each row execute function private.set_updated_at();

create table public.order_items (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  order_id     uuid not null,
  product_id   uuid not null,
  quantity     numeric(18, 6) not null check (quantity > 0), -- unidade de estoque do produto
  unit_price   numeric(14, 2) not null check (unit_price >= 0),
  total        numeric(14, 2) not null check (total >= 0),
  unit_cost    numeric(18, 6) check (unit_cost is null or unit_cost >= 0), -- custo médio na baixa
  movement_id  uuid references public.stock_movements (id),
  sort_order   int not null default 0,
  foreign key (company_id, order_id) references public.orders (company_id, id) on delete cascade,
  foreign key (company_id, product_id) references public.products (company_id, id),
  unique (order_id, product_id)
);

create table public.order_status_history (
  id          bigint generated always as identity primary key,
  company_id  uuid not null,
  order_id    uuid not null,
  status      text not null,
  note        text,
  changed_by  uuid,
  created_at  timestamptz not null default now(),
  foreign key (company_id, order_id) references public.orders (company_id, id) on delete cascade
);
create index order_status_history_order_idx on public.order_status_history (order_id, id);

create or replace function private.log_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_status_history (company_id, order_id, status, note, changed_by)
    values (new.company_id, new.id, new.status, nullif(current_setting('kairos.status_note', true), ''), (select auth.uid()));
  end if;
  return new;
end;
$$;
create trigger orders_status_history after insert or update of status on public.orders
  for each row execute function private.log_order_status();

-- Pagamentos (manual agora; Asaas na Fase 8 usa provider/external_id)
create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  order_id      uuid not null,
  provider      text not null default 'manual' check (provider in ('manual', 'asaas')),
  method        text not null check (method in ('pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'boleto', 'transferencia', 'outro')),
  amount        numeric(14, 2) not null check (amount > 0),
  status        text not null default 'confirmed' check (status in ('pending', 'confirmed', 'refunded', 'canceled')),
  external_id   text,
  confirmed_at  timestamptz,
  refunded_at   timestamptz,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  foreign key (company_id, order_id) references public.orders (company_id, id) on delete cascade
);
create unique index payments_external_uq on public.payments (provider, external_id) where external_id is not null;
create index payments_order_idx on public.payments (order_id);

-- ---------------------------------------------------------------------
-- Lançamentos financeiros (contas a receber e a pagar)
-- ---------------------------------------------------------------------
create table public.financial_transactions (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  type             text not null check (type in ('income', 'expense')),
  category_id      uuid not null references public.financial_categories (id),
  description      text not null check (char_length(btrim(description)) between 2 and 160),
  amount           numeric(14, 2) not null check (amount > 0),
  due_date         date not null,
  competence_date  date not null,
  status           text not null default 'open' check (status in ('open', 'paid', 'canceled')),
  paid_at          date,
  paid_amount      numeric(14, 2) check (paid_amount is null or paid_amount >= 0),
  payment_method   text check (payment_method is null or payment_method in ('pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'boleto', 'transferencia', 'outro')),
  customer_id      uuid,
  supplier_id      uuid,
  source_type      text check (source_type is null or source_type in ('order', 'order_refund', 'purchase_order')),
  source_id        uuid,
  notes            text check (notes is null or char_length(notes) <= 2000),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (status <> 'paid' or (paid_at is not null and paid_amount is not null)),
  foreign key (company_id, customer_id) references public.customers (company_id, id),
  foreign key (company_id, supplier_id) references public.suppliers (company_id, id)
);
create index financial_transactions_due_idx on public.financial_transactions (company_id, status, due_date);
create index financial_transactions_paid_idx on public.financial_transactions (company_id, paid_at) where status = 'paid';
create index financial_transactions_source_idx on public.financial_transactions (source_type, source_id) where source_id is not null;
-- uma conta a receber por pedido
create unique index financial_transactions_order_uq on public.financial_transactions (source_id) where source_type = 'order';

create trigger financial_transactions_updated_at before update on public.financial_transactions
  for each row execute function private.set_updated_at();

-- Categoria precisa ser do sistema ou da empresa, e do mesmo tipo.
create or replace function private.check_transaction_category()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cat public.financial_categories;
begin
  select * into v_cat from public.financial_categories where id = new.category_id;
  if v_cat.id is null or (v_cat.company_id is not null and v_cat.company_id <> new.company_id) then
    raise exception 'Categoria inválida' using errcode = 'P0001';
  end if;
  if v_cat.type <> new.type then
    raise exception 'Categoria "%" não é de %', v_cat.name, case new.type when 'income' then 'receita' else 'despesa' end
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger financial_transactions_category before insert or update of category_id, type on public.financial_transactions
  for each row execute function private.check_transaction_category();

-- ---------------------------------------------------------------------
-- Pedido: criação com reserva de estoque
--   p_items: [{"product_id": uuid, "quantity": n, "unit_price": n?}, …]
--   p_payment (opcional, venda no balcão): {"method": "pix", "paid_at": "2026-11-28"}
-- ---------------------------------------------------------------------
create or replace function private.reserve_product(p_company_id uuid, p_product_id uuid, p_qty numeric, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance public.stock_balances;
  v_allow_negative boolean;
begin
  insert into public.stock_balances (company_id, product_id) values (p_company_id, p_product_id)
    on conflict (company_id, product_id) where product_id is not null do nothing;
  select * into v_balance from public.stock_balances
   where company_id = p_company_id and product_id = p_product_id for update;
  select coalesce((settings ->> 'allow_negative_stock')::boolean, false) into v_allow_negative
    from public.companies where id = p_company_id;
  if v_balance.quantity - v_balance.reserved_quantity < p_qty and not v_allow_negative then
    raise exception 'Estoque insuficiente de "%": disponível %, pedido %', p_name,
      trim_scale(greatest(v_balance.quantity - v_balance.reserved_quantity, 0)), trim_scale(p_qty)
      using errcode = 'P0002', hint = 'stock_insufficient';
  end if;
  update public.stock_balances set reserved_quantity = reserved_quantity + p_qty, updated_at = now() where id = v_balance.id;
end;
$$;
revoke execute on function private.reserve_product(uuid, uuid, numeric, text) from public, anon, authenticated;

create or replace function private.release_reservation(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
begin
  for v_item in
    select i.company_id, i.product_id, i.quantity from public.order_items i where i.order_id = p_order_id order by i.product_id
  loop
    update public.stock_balances
       set reserved_quantity = greatest(reserved_quantity - v_item.quantity, 0), updated_at = now()
     where company_id = v_item.company_id and product_id = v_item.product_id;
  end loop;
end;
$$;
revoke execute on function private.release_reservation(uuid) from public, anon, authenticated;

-- Efetiva a venda: baixa (consumindo a reserva), pagamento e liquidação do recebível.
create or replace function private.confirm_order_payment(
  p_order_id uuid, p_method text, p_paid_at date, p_provider text, p_external_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_item record;
  v_cost numeric;
  v_mov public.stock_movements;
  v_label text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.status <> 'pending' then
    raise exception 'Pedido % não está aguardando pagamento', v_order.number using errcode = 'P0002';
  end if;
  if p_method not in ('pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'boleto', 'transferencia', 'outro') then
    raise exception 'Forma de pagamento inválida' using errcode = 'P0001';
  end if;
  if p_paid_at is null or p_paid_at > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Data de pagamento inválida' using errcode = 'P0001';
  end if;
  v_label := 'Pedido ' || v_order.number;

  for v_item in
    select i.id, i.product_id, i.quantity, p.unit_id
      from public.order_items i join public.products p on p.id = i.product_id
     where i.order_id = p_order_id
     order by i.product_id
  loop
    -- consome a reserva e baixa o estoque com o custo médio do momento
    update public.stock_balances
       set reserved_quantity = greatest(reserved_quantity - v_item.quantity, 0)
     where company_id = v_order.company_id and product_id = v_item.product_id
     returning avg_cost into v_cost;
    v_mov := private.apply_stock_movement(
      v_order.company_id, 'product', v_item.product_id, 'venda', -v_item.quantity, v_item.quantity, v_item.unit_id,
      v_cost, null, v_label, 'order', p_order_id
    );
    update public.order_items set unit_cost = v_cost, movement_id = v_mov.id where id = v_item.id;
  end loop;

  if v_order.total > 0 then
    insert into public.payments (company_id, order_id, provider, method, amount, status, external_id, confirmed_at, created_by)
    values (v_order.company_id, p_order_id, p_provider, p_method, v_order.total, 'confirmed', p_external_id, now(), (select auth.uid()));
  end if;

  update public.financial_transactions
     set status = 'paid', paid_at = p_paid_at, paid_amount = amount, payment_method = p_method
   where source_type = 'order' and source_id = p_order_id and status = 'open';

  -- pago hoje: agora; data retroativa: meio-dia (horário de Brasília) daquele dia
  update public.orders
     set status = 'paid',
         paid_at = case when p_paid_at = (now() at time zone 'America/Sao_Paulo')::date then now()
                        else (p_paid_at + time '12:00') at time zone 'America/Sao_Paulo' end
   where id = p_order_id;
end;
$$;
revoke execute on function private.confirm_order_payment(uuid, text, date, text, text) from public, anon, authenticated;

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
  v_order uuid;
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
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Inclua ao menos um produto' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Pedido com itens demais (máximo 200)' using errcode = 'P0001';
  end if;
  if coalesce(p_discount, 0) < 0 or coalesce(p_shipping, 0) < 0 then
    raise exception 'Desconto e frete não podem ser negativos' using errcode = 'P0001';
  end if;

  v_number := private.next_document_number(v_company, 'order');
  insert into public.orders (company_id, number, channel, customer_id, subtotal, discount, shipping, total, due_date, notes, created_by)
  values (v_company, v_number, 'manual', p_customer_id, 0, 0, 0, 0, p_due_date, nullif(btrim(p_notes), ''), (select auth.uid()))
  returning id into v_order;

  -- itens em ordem de produto (ordem fixa de travamento)
  for v_item in
    select e from jsonb_array_elements(p_items) e order by (e ->> 'product_id')
  loop
    select * into v_product from public.products where id = (v_item ->> 'product_id')::uuid and company_id = v_company;
    if v_product.id is null then
      raise exception 'Produto não encontrado' using errcode = 'P0001';
    end if;
    if v_product.status <> 'active' then
      raise exception '"%" não está ativo para venda', v_product.name using errcode = 'P0001';
    end if;
    if v_product.id = any (v_seen) then
      raise exception '"%" aparece mais de uma vez', v_product.name using errcode = 'P0001';
    end if;
    v_seen := v_seen || v_product.id;
    v_qty := (v_item ->> 'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantidade inválida para "%"', v_product.name using errcode = 'P0001';
    end if;
    v_price := round(coalesce((v_item ->> 'unit_price')::numeric, v_product.sale_price), 2);
    if v_price < 0 then
      raise exception 'Preço inválido para "%"', v_product.name using errcode = 'P0001';
    end if;

    perform private.reserve_product(v_company, v_product.id, v_qty, v_product.name);
    insert into public.order_items (company_id, order_id, product_id, quantity, unit_price, total, sort_order)
    values (v_company, v_order, v_product.id, v_qty, v_price, round(v_qty * v_price, 2), v_sort);
    v_subtotal := v_subtotal + round(v_qty * v_price, 2);
    v_sort := v_sort + 1;
  end loop;

  v_total := v_subtotal - round(coalesce(p_discount, 0), 2) + round(coalesce(p_shipping, 0), 2);
  if v_total < 0 then
    raise exception 'Desconto maior que o valor do pedido' using errcode = 'P0001';
  end if;
  update public.orders
     set subtotal = v_subtotal, discount = round(coalesce(p_discount, 0), 2), shipping = round(coalesce(p_shipping, 0), 2), total = v_total
   where id = v_order;

  if v_total > 0 then
    insert into public.financial_transactions (company_id, type, category_id, description, amount, due_date, competence_date,
                                               customer_id, source_type, source_id, created_by)
    values (v_company, 'income', private.category_id('sales'), 'Pedido ' || v_number, v_total,
            coalesce(p_due_date, v_today), v_today, p_customer_id, 'order', v_order, (select auth.uid()));
  end if;

  if p_payment is not null then
    perform private.confirm_order_payment(v_order, p_payment ->> 'method', coalesce((p_payment ->> 'paid_at')::date, v_today), 'manual', null);
  end if;

  v_result := jsonb_build_object('order_id', v_order, 'number', v_number, 'total', v_total,
                                 'status', case when p_payment is null then 'pending' else 'paid' end);
  perform private.record_client_op(v_company, p_client_op_id, 'order.create', v_result);
  return v_result;
end;
$$;
revoke execute on function public.fn_create_order(uuid, uuid, jsonb, numeric, numeric, date, text, jsonb) from public, anon;
grant execute on function public.fn_create_order(uuid, uuid, jsonb, numeric, numeric, date, text, jsonb) to authenticated;

-- Registrar pagamento de pedido aguardando (efetiva a venda).
create or replace function public.fn_register_order_payment(p_client_op_id uuid, p_order_id uuid, p_method text, p_paid_at date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_existing jsonb;
  v_result jsonb;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or not private.has_company_role(v_order.company_id, array['owner', 'admin', 'manager', 'operator']) then
    raise exception 'Pedido não encontrado ou sem permissão' using errcode = '42501';
  end if;
  v_existing := private.claim_client_op(v_order.company_id, p_client_op_id);
  if v_existing is not null then
    return v_existing;
  end if;

  perform private.confirm_order_payment(p_order_id, p_method,
    coalesce(p_paid_at, (now() at time zone 'America/Sao_Paulo')::date), 'manual', null);

  v_result := jsonb_build_object('order_id', p_order_id, 'number', v_order.number, 'status', 'paid');
  perform private.record_client_op(v_order.company_id, p_client_op_id, 'order.pay', v_result);
  return v_result;
end;
$$;
revoke execute on function public.fn_register_order_payment(uuid, uuid, text, date) from public, anon;
grant execute on function public.fn_register_order_payment(uuid, uuid, text, date) to authenticated;

-- Cancelar pedido aguardando pagamento: libera a reserva e cancela o recebível.
create or replace function public.fn_cancel_order(p_order_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or not private.has_company_role(v_order.company_id, array['owner', 'admin', 'manager', 'operator']) then
    raise exception 'Pedido não encontrado ou sem permissão' using errcode = '42501';
  end if;
  if v_order.status <> 'pending' then
    raise exception 'Somente pedidos aguardando pagamento podem ser cancelados; pedidos pagos são estornados'
      using errcode = 'P0001';
  end if;
  perform private.release_reservation(p_order_id);
  update public.financial_transactions set status = 'canceled'
   where source_type = 'order' and source_id = p_order_id and status = 'open';
  perform set_config('kairos.status_note', coalesce(btrim(p_reason), ''), true);
  update public.orders set status = 'canceled', close_reason = nullif(btrim(p_reason), ''), closed_at = now() where id = p_order_id;
  perform set_config('kairos.status_note', '', true);
end;
$$;
revoke execute on function public.fn_cancel_order(uuid, text) from public, anon;
grant execute on function public.fn_cancel_order(uuid, text) to authenticated;

create or replace function public.fn_mark_order_delivered(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or not private.has_company_role(v_order.company_id, array['owner', 'admin', 'manager', 'operator']) then
    raise exception 'Pedido não encontrado ou sem permissão' using errcode = '42501';
  end if;
  if v_order.status <> 'paid' then
    raise exception 'Somente pedidos pagos podem ser marcados como entregues' using errcode = 'P0001';
  end if;
  update public.orders set status = 'delivered', delivered_at = now() where id = p_order_id;
end;
$$;
revoke execute on function public.fn_mark_order_delivered(uuid) from public, anon;
grant execute on function public.fn_mark_order_delivered(uuid) to authenticated;

-- Estornar venda paga: devolve o estoque, estorna o pagamento e lança a saída de caixa.
create or replace function public.fn_refund_order(p_client_op_id uuid, p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_existing jsonb;
  v_mov record;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_method text;
  v_result jsonb;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Informe o motivo do estorno' using errcode = 'P0001';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or not private.has_company_role(v_order.company_id, array['owner', 'admin', 'manager']) then
    raise exception 'Pedido não encontrado ou sem permissão' using errcode = '42501';
  end if;
  v_existing := private.claim_client_op(v_order.company_id, p_client_op_id);
  if v_existing is not null then
    return v_existing;
  end if;
  if v_order.status not in ('paid', 'delivered') then
    raise exception 'Somente pedidos pagos podem ser estornados' using errcode = 'P0002';
  end if;

  for v_mov in
    select m.* from public.stock_movements m
     where m.source_type = 'order' and m.source_id = p_order_id and m.type = 'venda'
       and not exists (select 1 from public.stock_movements r where r.reversal_of = m.id)
     order by m.product_id
  loop
    perform private.apply_stock_movement(
      v_order.company_id, 'product', v_mov.product_id, 'estorno', -v_mov.quantity, -v_mov.input_quantity, v_mov.input_unit_id,
      null, p_reason, 'Pedido ' || v_order.number, 'order', p_order_id, v_mov.id
    );
  end loop;

  select method into v_method from public.payments where order_id = p_order_id and status = 'confirmed' limit 1;
  update public.payments set status = 'refunded', refunded_at = now() where order_id = p_order_id and status = 'confirmed';

  if v_order.total > 0 then
    insert into public.financial_transactions (company_id, type, category_id, description, amount, due_date, competence_date,
                                               status, paid_at, paid_amount, payment_method, customer_id, source_type, source_id, notes, created_by)
    values (v_order.company_id, 'expense', private.category_id('refunds'), 'Estorno do pedido ' || v_order.number, v_order.total,
            v_today, v_today, 'paid', v_today, v_order.total, v_method, v_order.customer_id, 'order_refund', p_order_id,
            btrim(p_reason), (select auth.uid()));
  end if;

  perform set_config('kairos.status_note', btrim(p_reason), true);
  update public.orders set status = 'refunded', close_reason = btrim(p_reason), closed_at = now() where id = p_order_id;
  perform set_config('kairos.status_note', '', true);

  v_result := jsonb_build_object('order_id', p_order_id, 'number', v_order.number, 'status', 'refunded');
  perform private.record_client_op(v_order.company_id, p_client_op_id, 'order.refund', v_result);
  return v_result;
end;
$$;
revoke execute on function public.fn_refund_order(uuid, uuid, text) from public, anon;
grant execute on function public.fn_refund_order(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Financeiro: lançamentos manuais, liquidação, cancelamento
-- ---------------------------------------------------------------------
create or replace function public.fn_save_transaction(
  p_id               uuid,
  p_type             text,
  p_category_id      uuid,
  p_description      text,
  p_amount           numeric,
  p_due_date         date,
  p_competence_date  date default null,
  p_supplier_id      uuid default null,
  p_customer_id      uuid default null,
  p_notes            text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.current_company_id();
  v_tx public.financial_transactions;
  v_id uuid;
begin
  if v_company is null or not private.has_company_role(v_company, array['owner', 'admin', 'manager']) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if p_type not in ('income', 'expense') then
    raise exception 'Tipo inválido' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Informe o valor' using errcode = 'P0001';
  end if;
  if p_due_date is null then
    raise exception 'Informe o vencimento' using errcode = 'P0001';
  end if;
  if p_supplier_id is not null and not exists (select 1 from public.suppliers where id = p_supplier_id and company_id = v_company) then
    raise exception 'Fornecedor inválido' using errcode = 'P0001';
  end if;
  if p_customer_id is not null and not exists (select 1 from public.customers where id = p_customer_id and company_id = v_company) then
    raise exception 'Cliente inválido' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into public.financial_transactions (company_id, type, category_id, description, amount, due_date, competence_date,
                                               supplier_id, customer_id, notes, created_by)
    values (v_company, p_type, p_category_id, btrim(p_description), round(p_amount, 2), p_due_date,
            coalesce(p_competence_date, p_due_date), p_supplier_id, p_customer_id, nullif(btrim(p_notes), ''), (select auth.uid()))
    returning id into v_id;
    return v_id;
  end if;

  select * into v_tx from public.financial_transactions where id = p_id and company_id = v_company for update;
  if v_tx.id is null then
    raise exception 'Lançamento não encontrado' using errcode = '42501';
  end if;
  if v_tx.status <> 'open' then
    raise exception 'Somente lançamentos em aberto podem ser alterados' using errcode = 'P0001';
  end if;
  if v_tx.source_type = 'order' then
    raise exception 'Conta a receber de pedido é alterada pelo próprio pedido' using errcode = 'P0001';
  end if;
  update public.financial_transactions
     set type = case when v_tx.source_type is null then p_type else v_tx.type end,
         category_id = p_category_id, description = btrim(p_description),
         amount = case when v_tx.source_type is null then round(p_amount, 2) else v_tx.amount end,
         due_date = p_due_date, competence_date = coalesce(p_competence_date, p_due_date),
         supplier_id = case when v_tx.source_type is null then p_supplier_id else v_tx.supplier_id end,
         customer_id = case when v_tx.source_type is null then p_customer_id else v_tx.customer_id end,
         notes = nullif(btrim(p_notes), '')
   where id = p_id;
  return p_id;
end;
$$;
revoke execute on function public.fn_save_transaction(uuid, text, uuid, text, numeric, date, date, uuid, uuid, text) from public, anon;
grant execute on function public.fn_save_transaction(uuid, text, uuid, text, numeric, date, date, uuid, uuid, text) to authenticated;

create or replace function public.fn_settle_transaction(p_id uuid, p_paid_at date, p_amount numeric, p_method text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.financial_transactions;
begin
  select * into v_tx from public.financial_transactions where id = p_id for update;
  if v_tx.id is null or not private.has_company_role(v_tx.company_id, array['owner', 'admin', 'manager']) then
    raise exception 'Lançamento não encontrado ou sem permissão' using errcode = '42501';
  end if;
  if v_tx.source_type = 'order' then
    raise exception 'Registre o pagamento no próprio pedido (ele baixa o estoque)' using errcode = 'P0001';
  end if;
  if v_tx.status <> 'open' then
    raise exception 'Lançamento já liquidado ou cancelado' using errcode = 'P0002';
  end if;
  if p_paid_at is null or p_paid_at > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Data de pagamento inválida' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Informe o valor pago' using errcode = 'P0001';
  end if;
  if p_method is not null and p_method not in ('pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'boleto', 'transferencia', 'outro') then
    raise exception 'Forma de pagamento inválida' using errcode = 'P0001';
  end if;
  update public.financial_transactions
     set status = 'paid', paid_at = p_paid_at, paid_amount = round(p_amount, 2), payment_method = p_method
   where id = p_id;
end;
$$;
revoke execute on function public.fn_settle_transaction(uuid, date, numeric, text) from public, anon;
grant execute on function public.fn_settle_transaction(uuid, date, numeric, text) to authenticated;

-- Desfaz a liquidação (lançamento manual ou de compra) ou cancela lançamento aberto.
create or replace function public.fn_set_transaction_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.financial_transactions;
begin
  select * into v_tx from public.financial_transactions where id = p_id for update;
  if v_tx.id is null or not private.has_company_role(v_tx.company_id, array['owner', 'admin', 'manager']) then
    raise exception 'Lançamento não encontrado ou sem permissão' using errcode = '42501';
  end if;
  if v_tx.source_type in ('order', 'order_refund') then
    raise exception 'Lançamento de pedido é controlado pelo próprio pedido' using errcode = 'P0001';
  end if;
  if p_status = 'open' and v_tx.status = 'paid' then
    update public.financial_transactions set status = 'open', paid_at = null, paid_amount = null, payment_method = null where id = p_id;
  elsif p_status = 'canceled' and v_tx.status = 'open' then
    update public.financial_transactions set status = 'canceled' where id = p_id;
  else
    raise exception 'Mudança de situação não permitida' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.fn_set_transaction_status(uuid, text) from public, anon;
grant execute on function public.fn_set_transaction_status(uuid, text) to authenticated;

-- Conta a pagar a partir de pedido de compra (parcelas somam no máximo o total do pedido).
create or replace function public.fn_create_purchase_payable(p_order_id uuid, p_amount numeric, p_due_date date, p_description text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
  v_used numeric;
  v_id uuid;
begin
  select * into v_order from public.purchase_orders where id = p_order_id for update;
  if v_order.id is null or not private.has_company_role(v_order.company_id, array['owner', 'admin', 'manager']) then
    raise exception 'Pedido não encontrado ou sem permissão' using errcode = '42501';
  end if;
  if v_order.status = 'canceled' then
    raise exception 'Pedido cancelado' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 or p_due_date is null then
    raise exception 'Informe valor e vencimento' using errcode = 'P0001';
  end if;
  select coalesce(sum(amount), 0) into v_used from public.financial_transactions
   where source_type = 'purchase_order' and source_id = p_order_id and status <> 'canceled';
  if v_used + round(p_amount, 2) > v_order.total then
    raise exception 'Contas a pagar somariam % e o pedido é de %', v_used + round(p_amount, 2), v_order.total using errcode = 'P0001';
  end if;
  insert into public.financial_transactions (company_id, type, category_id, description, amount, due_date, competence_date,
                                             supplier_id, source_type, source_id, created_by)
  values (v_order.company_id, 'expense', private.category_id('purchases'),
          coalesce(nullif(btrim(p_description), ''), 'Pedido de compra ' || v_order.number), round(p_amount, 2),
          p_due_date, (v_order.created_at at time zone 'America/Sao_Paulo')::date, v_order.supplier_id,
          'purchase_order', p_order_id, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.fn_create_purchase_payable(uuid, numeric, date, text) from public, anon;
grant execute on function public.fn_create_purchase_payable(uuid, numeric, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- Visão de vendas efetivadas por item (relatórios; respeita RLS)
-- ---------------------------------------------------------------------
create view public.sales_items with (security_invoker = true) as
select
  o.company_id,
  o.id            as order_id,
  o.number,
  o.channel,
  o.customer_id,
  o.status,
  o.paid_at,
  (o.paid_at at time zone 'America/Sao_Paulo')::date as paid_date,
  i.product_id,
  i.quantity,
  i.unit_price,
  i.total         as gross,
  -- desconto do pedido rateado pelo valor de cada item
  round(case when o.subtotal > 0 then i.total - o.discount * i.total / o.subtotal else 0 end, 2) as net,
  i.unit_cost,
  round(i.quantity * coalesce(i.unit_cost, 0), 2) as cost
from public.orders o
join public.order_items i on i.order_id = o.id
where o.status in ('paid', 'delivered');

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
create trigger orders_audit after insert or update on public.orders
  for each row execute function private.audit_row();
create trigger payments_audit after insert or update on public.payments
  for each row execute function private.audit_row();
create trigger financial_transactions_audit after insert or update on public.financial_transactions
  for each row execute function private.audit_row();
create trigger financial_categories_audit after insert or update on public.financial_categories
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.financial_categories    enable row level security;
alter table public.orders                  enable row level security;
alter table public.order_items             enable row level security;
alter table public.order_status_history    enable row level security;
alter table public.payments                enable row level security;
alter table public.financial_transactions  enable row level security;

create policy financial_categories_select on public.financial_categories for select to authenticated
  using (company_id is null or private.is_company_member(company_id));
create policy financial_categories_insert on public.financial_categories for insert to authenticated
  with check (company_id is not null and key is null and private.has_company_role(company_id, array['owner', 'admin', 'manager']));
create policy financial_categories_update on public.financial_categories for update to authenticated
  using (company_id is not null and private.has_company_role(company_id, array['owner', 'admin', 'manager']))
  with check (company_id is not null and key is null and private.has_company_role(company_id, array['owner', 'admin', 'manager']));
revoke delete, truncate on public.financial_categories from anon, authenticated;

create policy orders_select on public.orders for select to authenticated
  using (private.is_company_member(company_id));
create policy order_items_select on public.order_items for select to authenticated
  using (private.is_company_member(company_id));
create policy order_status_history_select on public.order_status_history for select to authenticated
  using (private.is_company_member(company_id));
create policy payments_select on public.payments for select to authenticated
  using (private.is_company_member(company_id));
-- financeiro: só quem gerencia vê valores a pagar/receber
create policy financial_transactions_select on public.financial_transactions for select to authenticated
  using (private.has_company_role(company_id, array['owner', 'admin', 'manager']));

revoke insert, update, delete, truncate on
  public.orders, public.order_items, public.order_status_history, public.payments, public.financial_transactions
  from anon, authenticated;
revoke insert, update, delete, truncate on public.financial_categories from anon;
