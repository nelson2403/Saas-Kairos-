-- =====================================================================
-- SAS KAIRÓS — Fase 2: produtos, matérias-primas, unidades e estoque
--
-- Regras:
--  * Quantidades numeric(18,6), dinheiro numeric(14,2), custos numeric(18,6).
--  * Saldos e movimentações NÃO têm escrita pela API. Toda alteração de
--    estoque passa por funções transacionais que travam o saldo
--    (SELECT ... FOR UPDATE), validam e gravam tudo ou nada.
--  * Movimentações são imutáveis; correção = estorno (uma única vez).
--  * Integridade entre empresas por FKs compostas (company_id, id).
-- =====================================================================

-- Empresa do usuário atual (versão 1: um vínculo ativo por usuário).
create or replace function private.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.company_id
  from public.company_members m
  where m.user_id = (select auth.uid()) and m.status = 'active'
  limit 1;
$$;
grant execute on function private.current_company_id() to authenticated;
revoke execute on function private.current_company_id() from anon, public;

-- Papéis que operam estoque / que gerenciam cadastros.
-- (constantes usadas nas políticas e funções abaixo)
--   operam:     owner, admin, manager, operator
--   gerenciam:  owner, admin, manager

-- ---------------------------------------------------------------------
-- Unidades de medida
-- ---------------------------------------------------------------------
create table public.measurement_units (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references public.companies (id) on delete cascade, -- null = unidade do sistema
  code            text not null check (code ~ '^[a-z0-9]{1,12}$'),
  name            text not null check (char_length(btrim(name)) between 1 and 60),
  dimension       text not null check (dimension in ('mass', 'volume', 'length', 'unit')),
  -- quantas unidades-base (g, ml, m, un) cabem em 1 desta unidade
  factor_to_base  numeric(24, 12) not null check (factor_to_base > 0),
  is_system       boolean not null default false,
  created_at      timestamptz not null default now(),
  unique nulls not distinct (company_id, code)
);

insert into public.measurement_units (company_id, code, name, dimension, factor_to_base, is_system) values
  (null, 'un', 'Unidade',    'unit',   1,       true),
  (null, 'dz', 'Dúzia',      'unit',   12,      true),
  (null, 'mg', 'Miligrama',  'mass',   0.001,   true),
  (null, 'g',  'Grama',      'mass',   1,       true),
  (null, 'kg', 'Quilograma', 'mass',   1000,    true),
  (null, 'ml', 'Mililitro',  'volume', 1,       true),
  (null, 'l',  'Litro',      'volume', 1000,    true),
  (null, 'mm', 'Milímetro',  'length', 0.001,   true),
  (null, 'cm', 'Centímetro', 'length', 0.01,    true),
  (null, 'm',  'Metro',      'length', 1,       true);

-- Converte quantidade entre unidades. Massa <-> volume só com densidade (g/ml).
create or replace function private.convert_quantity(
  p_quantity numeric, p_from uuid, p_to uuid, p_density numeric default null
)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  f public.measurement_units;
  t public.measurement_units;
  v_base numeric;
begin
  if p_from = p_to then
    return p_quantity;
  end if;
  select * into f from public.measurement_units where id = p_from;
  select * into t from public.measurement_units where id = p_to;
  if f.id is null or t.id is null then
    raise exception 'Unidade de medida inválida' using errcode = 'P0001';
  end if;

  v_base := p_quantity * f.factor_to_base;
  if f.dimension = t.dimension then
    return round(v_base / t.factor_to_base, 6);
  elsif f.dimension = 'volume' and t.dimension = 'mass' and p_density > 0 then
    return round(v_base * p_density / t.factor_to_base, 6);
  elsif f.dimension = 'mass' and t.dimension = 'volume' and p_density > 0 then
    return round(v_base / p_density / t.factor_to_base, 6);
  end if;

  raise exception 'Não é possível converter % para %', f.code, t.code using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------
-- Categorias de produtos (árvore)
-- ---------------------------------------------------------------------
create table public.product_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  parent_id   uuid,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, parent_id) references public.product_categories (company_id, id) on delete set null (parent_id),
  check (parent_id is null or parent_id <> id)
);
create unique index product_categories_name_uq
  on public.product_categories (company_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create or replace function private.check_category_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null and exists (
    with recursive up as (
      select c.id, c.parent_id from public.product_categories c where c.id = new.parent_id
      union all
      select c.id, c.parent_id from public.product_categories c join up on c.id = up.parent_id
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'Categoria não pode ser subcategoria de si mesma' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger product_categories_cycle before insert or update of parent_id on public.product_categories
  for each row execute function private.check_category_cycle();
create trigger product_categories_updated_at before update on public.product_categories
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Produtos
-- ---------------------------------------------------------------------
create table public.products (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  category_id    uuid,
  name           text not null check (char_length(btrim(name)) between 2 and 160),
  slug           text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  sku            text check (sku is null or char_length(sku) between 1 and 60),
  barcode        text check (barcode is null or barcode ~ '^[0-9A-Za-z\-]{4,48}$'),
  description    text check (description is null or char_length(description) <= 5000),
  unit_id        uuid not null references public.measurement_units (id),
  sale_price     numeric(14, 2) not null default 0 check (sale_price >= 0),
  cost_price     numeric(18, 6) check (cost_price is null or cost_price >= 0),
  min_stock      numeric(18, 6) not null default 0 check (min_stock >= 0),
  status         text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  show_in_store  boolean not null default false,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, slug),
  foreign key (company_id, category_id) references public.product_categories (company_id, id) on delete set null (category_id)
);
create unique index products_sku_uq on public.products (company_id, lower(sku)) where sku is not null;
create unique index products_barcode_uq on public.products (company_id, barcode) where barcode is not null;
create index products_category_idx on public.products (company_id, category_id);

create trigger products_updated_at before update on public.products
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Matérias-primas
-- ---------------------------------------------------------------------
create table public.raw_materials (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 2 and 160),
  code        text check (code is null or char_length(code) between 1 and 60),
  unit_id     uuid not null references public.measurement_units (id),
  density     numeric(12, 6) check (density is null or density > 0), -- g/ml
  min_stock   numeric(18, 6) not null default 0 check (min_stock >= 0),
  last_cost   numeric(18, 6) check (last_cost is null or last_cost >= 0), -- por unidade de estoque
  status      text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  notes       text check (notes is null or char_length(notes) <= 2000),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, id)
);
create unique index raw_materials_code_uq on public.raw_materials (company_id, lower(code)) where code is not null;

create trigger raw_materials_updated_at before update on public.raw_materials
  for each row execute function private.set_updated_at();

-- A unidade de estoque não muda depois que há movimentações (os saldos ficariam errados).
create or replace function private.lock_stock_unit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.unit_id is distinct from old.unit_id and exists (
    select 1 from public.stock_movements s
    where (tg_table_name = 'products' and s.product_id = old.id)
       or (tg_table_name = 'raw_materials' and s.raw_material_id = old.id)
  ) then
    raise exception 'A unidade de estoque não pode ser alterada após movimentações' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Saldos e movimentações
-- ---------------------------------------------------------------------
create table public.stock_balances (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  product_id         uuid,
  raw_material_id    uuid,
  quantity           numeric(18, 6) not null default 0,
  reserved_quantity  numeric(18, 6) not null default 0 check (reserved_quantity >= 0),
  avg_cost           numeric(18, 6) not null default 0 check (avg_cost >= 0),
  updated_at         timestamptz not null default now(),
  check (num_nonnulls(product_id, raw_material_id) = 1),
  foreign key (company_id, product_id) references public.products (company_id, id) on delete cascade,
  foreign key (company_id, raw_material_id) references public.raw_materials (company_id, id) on delete cascade
);
create unique index stock_balances_product_uq on public.stock_balances (company_id, product_id) where product_id is not null;
create unique index stock_balances_raw_uq on public.stock_balances (company_id, raw_material_id) where raw_material_id is not null;

create table public.stock_movements (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  product_id       uuid,
  raw_material_id  uuid,
  type             text not null check (type in (
                     'entrada', 'saida', 'ajuste', 'perda', 'descarte', 'devolucao', 'estorno',
                     'compra', 'producao_consumo', 'producao_entrada', 'venda')),
  quantity         numeric(18, 6) not null check (quantity <> 0), -- delta na unidade de estoque (+ entra, - sai)
  input_quantity   numeric(18, 6) not null,                         -- como o usuário informou
  input_unit_id    uuid not null references public.measurement_units (id),
  balance_before   numeric(18, 6) not null,
  balance_after    numeric(18, 6) not null,
  unit_cost        numeric(18, 6) check (unit_cost is null or unit_cost >= 0), -- por unidade de estoque
  reason           text check (reason is null or char_length(reason) <= 300),
  notes            text check (notes is null or char_length(notes) <= 2000),
  source_type      text,
  source_id        uuid,
  reversal_of      uuid references public.stock_movements (id),
  client_op_id     uuid,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  check (num_nonnulls(product_id, raw_material_id) = 1),
  foreign key (company_id, product_id) references public.products (company_id, id),
  foreign key (company_id, raw_material_id) references public.raw_materials (company_id, id)
);
create unique index stock_movements_reversal_uq on public.stock_movements (reversal_of) where reversal_of is not null;
create index stock_movements_company_idx on public.stock_movements (company_id, created_at desc);
create index stock_movements_product_idx on public.stock_movements (product_id, created_at desc) where product_id is not null;
create index stock_movements_raw_idx on public.stock_movements (raw_material_id, created_at desc) where raw_material_id is not null;

-- Imutável para todos, inclusive para a chave secreta.
create or replace function private.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% é imutável; use estorno', tg_table_name using errcode = 'P0001';
end;
$$;
create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function private.forbid_change();

create trigger products_lock_unit before update of unit_id on public.products
  for each row execute function private.lock_stock_unit();
create trigger raw_materials_lock_unit before update of unit_id on public.raw_materials
  for each row execute function private.lock_stock_unit();

-- ---------------------------------------------------------------------
-- Núcleo: aplica um delta ao saldo (uso interno das funções públicas)
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
      trim_scale(v_balance.quantity), trim_scale(-p_delta)
      using errcode = 'P0002', hint = 'stock_insufficient';
  end if;

  -- Custo médio ponderado: só entradas com custo informado alteram o custo médio.
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

-- Resultado de operação idempotente já aplicada (ou null).
create or replace function private.claim_client_op(p_company_id uuid, p_client_op_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_client_op_id is null then
    return null;
  end if;
  -- Serializa reenvios simultâneos da mesma operação.
  perform pg_advisory_xact_lock(hashtext('kairos.op.' || p_client_op_id::text));
  select result into v_result from public.client_operations
    where company_id = p_company_id and client_op_id = p_client_op_id;
  return case when v_result is null then null else v_result || '{"duplicate": true}'::jsonb end;
end;
$$;
revoke execute on function private.claim_client_op(uuid, uuid) from public, anon, authenticated;

create or replace function private.record_client_op(p_company_id uuid, p_client_op_id uuid, p_operation text, p_result jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.client_operations (company_id, user_id, client_op_id, operation, status, result)
  select p_company_id, (select auth.uid()), p_client_op_id, p_operation, 'applied', p_result
  where p_client_op_id is not null;
$$;
revoke execute on function private.record_client_op(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- API: registrar movimentação manual
-- ---------------------------------------------------------------------
create or replace function public.fn_register_stock_movement(
  p_client_op_id  uuid,
  p_item_type     text,
  p_item_id       uuid,
  p_type          text,
  p_quantity      numeric,
  p_unit_id       uuid default null,
  p_unit_cost     numeric default null, -- por unidade informada (p_unit_id)
  p_reason        text default null,
  p_notes         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_stock_unit uuid;
  v_density numeric;
  v_status text;
  v_unit uuid;
  v_stock_qty numeric;
  v_delta numeric;
  v_cost numeric;
  v_existing jsonb;
  v_mov public.stock_movements;
  v_result jsonb;
begin
  if p_item_type not in ('product', 'raw_material') then
    raise exception 'Tipo de item inválido' using errcode = 'P0001';
  end if;
  if p_type not in ('entrada', 'saida', 'ajuste', 'perda', 'descarte', 'devolucao') then
    raise exception 'Tipo de movimentação inválido' using errcode = 'P0001';
  end if;
  if p_quantity is null or p_quantity = 0 then
    raise exception 'Informe a quantidade' using errcode = 'P0001';
  end if;
  if p_type <> 'ajuste' and p_quantity < 0 then
    raise exception 'A quantidade deve ser positiva' using errcode = 'P0001';
  end if;
  if p_type in ('ajuste', 'perda', 'descarte') and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Informe o motivo' using errcode = 'P0001';
  end if;
  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception 'Custo inválido' using errcode = 'P0001';
  end if;

  if p_item_type = 'product' then
    select company_id, unit_id, null, status into v_company, v_stock_unit, v_density, v_status
      from public.products where id = p_item_id;
  else
    select company_id, unit_id, density, status into v_company, v_stock_unit, v_density, v_status
      from public.raw_materials where id = p_item_id;
  end if;

  if v_company is null or not private.has_company_role(v_company, array['owner', 'admin', 'manager', 'operator']) then
    raise exception 'Item não encontrado ou sem permissão' using errcode = '42501';
  end if;
  if v_status = 'archived' then
    raise exception 'Item arquivado não pode ser movimentado' using errcode = 'P0001';
  end if;

  v_existing := private.claim_client_op(v_company, p_client_op_id);
  if v_existing is not null then
    return v_existing;
  end if;

  v_unit := coalesce(p_unit_id, v_stock_unit);
  v_stock_qty := private.convert_quantity(abs(p_quantity), v_unit, v_stock_unit, v_density);
  if v_stock_qty = 0 then
    raise exception 'Quantidade muito pequena para a unidade de estoque' using errcode = 'P0001';
  end if;
  v_delta := case
    when p_type in ('entrada', 'devolucao') then v_stock_qty
    when p_type in ('saida', 'perda', 'descarte') then -v_stock_qty
    else sign(p_quantity) * v_stock_qty
  end;
  -- custo por unidade de estoque
  v_cost := case when p_unit_cost is null then null else round(p_unit_cost * abs(p_quantity) / v_stock_qty, 6) end;

  v_mov := private.apply_stock_movement(
    v_company, p_item_type, p_item_id, p_type, v_delta, p_quantity, v_unit,
    case when v_delta > 0 then v_cost end, p_reason, p_notes,
    null, null, null, p_client_op_id
  );

  v_result := jsonb_build_object(
    'movement_id', v_mov.id,
    'balance_after', v_mov.balance_after,
    'quantity', v_mov.quantity
  );
  perform private.record_client_op(v_company, p_client_op_id, 'stock.movement', v_result);
  return v_result;
end;
$$;
revoke execute on function public.fn_register_stock_movement(uuid, text, uuid, text, numeric, uuid, numeric, text, text) from public, anon;
grant execute on function public.fn_register_stock_movement(uuid, text, uuid, text, numeric, uuid, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- API: estornar movimentação manual (uma única vez)
-- ---------------------------------------------------------------------
create or replace function public.fn_reverse_stock_movement(
  p_client_op_id  uuid,
  p_movement_id   uuid,
  p_reason        text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orig public.stock_movements;
  v_existing jsonb;
  v_mov public.stock_movements;
  v_result jsonb;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Informe o motivo do estorno' using errcode = 'P0001';
  end if;

  select * into v_orig from public.stock_movements where id = p_movement_id for update;
  if v_orig.id is null or not private.has_company_role(v_orig.company_id, array['owner', 'admin', 'manager']) then
    raise exception 'Movimentação não encontrada ou sem permissão' using errcode = '42501';
  end if;

  v_existing := private.claim_client_op(v_orig.company_id, p_client_op_id);
  if v_existing is not null then
    return v_existing;
  end if;

  if v_orig.type = 'estorno' then
    raise exception 'Um estorno não pode ser estornado' using errcode = 'P0001';
  end if;
  if v_orig.source_type is not null then
    raise exception 'Esta movimentação pertence a um documento (%) e deve ser estornada por ele', v_orig.source_type
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.stock_movements where reversal_of = v_orig.id) then
    raise exception 'Movimentação já estornada' using errcode = 'P0001';
  end if;

  v_mov := private.apply_stock_movement(
    v_orig.company_id,
    case when v_orig.product_id is not null then 'product' else 'raw_material' end,
    coalesce(v_orig.product_id, v_orig.raw_material_id),
    'estorno', -v_orig.quantity, -v_orig.input_quantity, v_orig.input_unit_id,
    null, p_reason, null, null, null, v_orig.id, p_client_op_id
  );

  v_result := jsonb_build_object('movement_id', v_mov.id, 'balance_after', v_mov.balance_after);
  perform private.record_client_op(v_orig.company_id, p_client_op_id, 'stock.reverse', v_result);
  return v_result;
end;
$$;
revoke execute on function public.fn_reverse_stock_movement(uuid, uuid, text) from public, anon;
grant execute on function public.fn_reverse_stock_movement(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Inventário (contagem física)
-- ---------------------------------------------------------------------
create table public.inventory_counts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  scope        text not null check (scope in ('all', 'products', 'raw_materials')),
  status       text not null default 'open' check (status in ('open', 'applied', 'canceled')),
  notes        text check (notes is null or char_length(notes) <= 2000),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  closed_by    uuid,
  closed_at    timestamptz,
  unique (company_id, id)
);
create index inventory_counts_company_idx on public.inventory_counts (company_id, created_at desc);

create table public.inventory_count_items (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null,
  count_id           uuid not null,
  product_id         uuid,
  raw_material_id    uuid,
  expected_quantity  numeric(18, 6) not null, -- saldo do sistema na abertura
  counted_quantity   numeric(18, 6) check (counted_quantity is null or counted_quantity >= 0),
  counted_by         uuid,
  counted_at         timestamptz,
  check (num_nonnulls(product_id, raw_material_id) = 1),
  foreign key (company_id, count_id) references public.inventory_counts (company_id, id) on delete cascade,
  foreign key (company_id, product_id) references public.products (company_id, id),
  foreign key (company_id, raw_material_id) references public.raw_materials (company_id, id),
  unique (count_id, product_id),
  unique (count_id, raw_material_id)
);

-- Quem conta registra; só a quantidade contada é editável e só com a contagem aberta.
create or replace function private.inventory_item_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select status from public.inventory_counts where id = new.count_id) <> 'open' then
    raise exception 'Contagem encerrada' using errcode = 'P0001';
  end if;
  new.counted_by := (select auth.uid());
  new.counted_at := case when new.counted_quantity is null then null else now() end;
  return new;
end;
$$;
create trigger inventory_count_items_guard before update on public.inventory_count_items
  for each row execute function private.inventory_item_guard();

create or replace function public.fn_create_inventory_count(p_scope text, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := private.current_company_id();
  v_count uuid;
begin
  if v_company is null or not private.has_company_role(v_company, array['owner', 'admin', 'manager']) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if p_scope not in ('all', 'products', 'raw_materials') then
    raise exception 'Escopo inválido' using errcode = 'P0001';
  end if;

  insert into public.inventory_counts (company_id, scope, notes, created_by)
  values (v_company, p_scope, nullif(btrim(p_notes), ''), (select auth.uid()))
  returning id into v_count;

  if p_scope in ('all', 'products') then
    insert into public.inventory_count_items (company_id, count_id, product_id, expected_quantity)
    select v_company, v_count, p.id, coalesce(b.quantity, 0)
      from public.products p
      left join public.stock_balances b on b.company_id = p.company_id and b.product_id = p.id
     where p.company_id = v_company and p.status = 'active';
  end if;
  if p_scope in ('all', 'raw_materials') then
    insert into public.inventory_count_items (company_id, count_id, raw_material_id, expected_quantity)
    select v_company, v_count, r.id, coalesce(b.quantity, 0)
      from public.raw_materials r
      left join public.stock_balances b on b.company_id = r.company_id and b.raw_material_id = r.id
     where r.company_id = v_company and r.status = 'active';
  end if;

  return v_count;
end;
$$;
revoke execute on function public.fn_create_inventory_count(text, text) from public, anon;
grant execute on function public.fn_create_inventory_count(text, text) to authenticated;

-- Aplica a contagem: o saldo de cada item contado passa a ser a quantidade contada.
-- Gera um ajuste por item com diferença, tudo na mesma transação.
create or replace function public.fn_apply_inventory_count(p_count_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count public.inventory_counts;
  v_item record;
  v_current numeric;
  v_unit uuid;
  v_adjusted int := 0;
begin
  select * into v_count from public.inventory_counts where id = p_count_id for update;
  if v_count.id is null or not private.has_company_role(v_count.company_id, array['owner', 'admin', 'manager']) then
    raise exception 'Contagem não encontrada ou sem permissão' using errcode = '42501';
  end if;
  if v_count.status <> 'open' then
    raise exception 'Contagem já encerrada' using errcode = 'P0001';
  end if;

  for v_item in
    select * from public.inventory_count_items
     where count_id = p_count_id and counted_quantity is not null
     order by coalesce(product_id, raw_material_id) -- ordem fixa de travamento
  loop
    -- Garante a linha de saldo e trava antes de ler (sem corrida com outras movimentações).
    if v_item.product_id is not null then
      insert into public.stock_balances (company_id, product_id) values (v_count.company_id, v_item.product_id)
        on conflict (company_id, product_id) where product_id is not null do nothing;
      select quantity into v_current from public.stock_balances
       where company_id = v_count.company_id and product_id = v_item.product_id for update;
      select unit_id into v_unit from public.products where id = v_item.product_id;
    else
      insert into public.stock_balances (company_id, raw_material_id) values (v_count.company_id, v_item.raw_material_id)
        on conflict (company_id, raw_material_id) where raw_material_id is not null do nothing;
      select quantity into v_current from public.stock_balances
       where company_id = v_count.company_id and raw_material_id = v_item.raw_material_id for update;
      select unit_id into v_unit from public.raw_materials where id = v_item.raw_material_id;
    end if;

    if v_item.counted_quantity <> v_current then
      perform private.apply_stock_movement(
        v_count.company_id,
        case when v_item.product_id is not null then 'product' else 'raw_material' end,
        coalesce(v_item.product_id, v_item.raw_material_id),
        'ajuste', v_item.counted_quantity - v_current, v_item.counted_quantity - v_current, v_unit,
        null, 'Inventário', null, 'inventory_count', p_count_id
      );
      v_adjusted := v_adjusted + 1;
    end if;
  end loop;

  update public.inventory_counts
     set status = 'applied', closed_by = (select auth.uid()), closed_at = now()
   where id = p_count_id;

  return jsonb_build_object('adjusted', v_adjusted);
end;
$$;
revoke execute on function public.fn_apply_inventory_count(uuid) from public, anon;
grant execute on function public.fn_apply_inventory_count(uuid) to authenticated;

create or replace function public.fn_cancel_inventory_count(p_count_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count public.inventory_counts;
begin
  select * into v_count from public.inventory_counts where id = p_count_id for update;
  if v_count.id is null or not private.has_company_role(v_count.company_id, array['owner', 'admin', 'manager']) then
    raise exception 'Contagem não encontrada ou sem permissão' using errcode = '42501';
  end if;
  if v_count.status <> 'open' then
    raise exception 'Contagem já encerrada' using errcode = 'P0001';
  end if;
  update public.inventory_counts set status = 'canceled', closed_by = (select auth.uid()), closed_at = now()
   where id = p_count_id;
end;
$$;
revoke execute on function public.fn_cancel_inventory_count(uuid) from public, anon;
grant execute on function public.fn_cancel_inventory_count(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Visão de estoque (saldos + alerta de mínimo). security_invoker → respeita RLS.
-- ---------------------------------------------------------------------
create view public.stock_overview with (security_invoker = true) as
select
  'product'::text            as item_type,
  p.id                       as item_id,
  p.company_id,
  p.name,
  p.sku                      as code,
  p.status,
  u.code                     as unit_code,
  coalesce(b.quantity, 0)          as quantity,
  coalesce(b.reserved_quantity, 0) as reserved_quantity,
  coalesce(b.quantity, 0) - coalesce(b.reserved_quantity, 0) as available_quantity,
  p.min_stock,
  coalesce(b.avg_cost, 0)    as avg_cost,
  (p.min_stock > 0 and coalesce(b.quantity, 0) - coalesce(b.reserved_quantity, 0) <= p.min_stock) as below_min,
  b.updated_at               as balance_updated_at
from public.products p
join public.measurement_units u on u.id = p.unit_id
left join public.stock_balances b on b.company_id = p.company_id and b.product_id = p.id
union all
select
  'raw_material', r.id, r.company_id, r.name, r.code, r.status, u.code,
  coalesce(b.quantity, 0), coalesce(b.reserved_quantity, 0),
  coalesce(b.quantity, 0) - coalesce(b.reserved_quantity, 0),
  r.min_stock, coalesce(b.avg_cost, 0),
  (r.min_stock > 0 and coalesce(b.quantity, 0) - coalesce(b.reserved_quantity, 0) <= r.min_stock),
  b.updated_at
from public.raw_materials r
join public.measurement_units u on u.id = r.unit_id
left join public.stock_balances b on b.company_id = r.company_id and b.raw_material_id = r.id;

-- ---------------------------------------------------------------------
-- Auditoria dos cadastros
-- ---------------------------------------------------------------------
create trigger measurement_units_audit after insert or update or delete on public.measurement_units
  for each row execute function private.audit_row();
create trigger product_categories_audit after insert or update or delete on public.product_categories
  for each row execute function private.audit_row();
create trigger products_audit after insert or update or delete on public.products
  for each row execute function private.audit_row();
create trigger raw_materials_audit after insert or update or delete on public.raw_materials
  for each row execute function private.audit_row();
create trigger inventory_counts_audit after insert or update on public.inventory_counts
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.measurement_units     enable row level security;
alter table public.product_categories    enable row level security;
alter table public.products              enable row level security;
alter table public.raw_materials         enable row level security;
alter table public.stock_balances        enable row level security;
alter table public.stock_movements       enable row level security;
alter table public.inventory_counts      enable row level security;
alter table public.inventory_count_items enable row level security;

-- unidades: do sistema para todos os autenticados; personalizadas para membros
create policy measurement_units_select on public.measurement_units for select to authenticated
  using (company_id is null or private.is_company_member(company_id));
create policy measurement_units_insert on public.measurement_units for insert to authenticated
  with check (company_id is not null and not is_system
              and private.has_company_role(company_id, array['owner', 'admin', 'manager']));
create policy measurement_units_update on public.measurement_units for update to authenticated
  using (company_id is not null and private.has_company_role(company_id, array['owner', 'admin', 'manager']))
  with check (company_id is not null and not is_system
              and private.has_company_role(company_id, array['owner', 'admin', 'manager']));

-- cadastros: leitura para membros; escrita para owner/admin/manager; sem exclusão (arquivar)
create policy product_categories_select on public.product_categories for select to authenticated
  using (private.is_company_member(company_id));
create policy product_categories_insert on public.product_categories for insert to authenticated
  with check (private.has_company_role(company_id, array['owner', 'admin', 'manager']));
create policy product_categories_update on public.product_categories for update to authenticated
  using (private.has_company_role(company_id, array['owner', 'admin', 'manager']))
  with check (private.has_company_role(company_id, array['owner', 'admin', 'manager']));
create policy product_categories_delete on public.product_categories for delete to authenticated
  using (private.has_company_role(company_id, array['owner', 'admin', 'manager']));

create policy products_select on public.products for select to authenticated
  using (private.is_company_member(company_id));
create policy products_insert on public.products for insert to authenticated
  with check (private.has_company_role(company_id, array['owner', 'admin', 'manager']));
create policy products_update on public.products for update to authenticated
  using (private.has_company_role(company_id, array['owner', 'admin', 'manager']))
  with check (private.has_company_role(company_id, array['owner', 'admin', 'manager']));

create policy raw_materials_select on public.raw_materials for select to authenticated
  using (private.is_company_member(company_id));
create policy raw_materials_insert on public.raw_materials for insert to authenticated
  with check (private.has_company_role(company_id, array['owner', 'admin', 'manager']));
create policy raw_materials_update on public.raw_materials for update to authenticated
  using (private.has_company_role(company_id, array['owner', 'admin', 'manager']))
  with check (private.has_company_role(company_id, array['owner', 'admin', 'manager']));

-- saldos e movimentações: somente leitura pela API
create policy stock_balances_select on public.stock_balances for select to authenticated
  using (private.is_company_member(company_id));
create policy stock_movements_select on public.stock_movements for select to authenticated
  using (private.is_company_member(company_id));
revoke insert, update, delete, truncate on public.stock_balances, public.stock_movements from anon, authenticated;

-- inventário: leitura para membros; contagem editável (só a quantidade) por quem opera estoque
create policy inventory_counts_select on public.inventory_counts for select to authenticated
  using (private.is_company_member(company_id));
revoke insert, update, delete, truncate on public.inventory_counts from anon, authenticated;

create policy inventory_count_items_select on public.inventory_count_items for select to authenticated
  using (private.is_company_member(company_id));
create policy inventory_count_items_update on public.inventory_count_items for update to authenticated
  using (private.has_company_role(company_id, array['owner', 'admin', 'manager', 'operator']))
  with check (private.has_company_role(company_id, array['owner', 'admin', 'manager', 'operator']));
revoke insert, update, delete, truncate on public.inventory_count_items from anon, authenticated;
grant update (counted_quantity) on public.inventory_count_items to authenticated;

-- nada de escrita anônima em cadastros
revoke insert, update, delete, truncate on
  public.measurement_units, public.product_categories, public.products, public.raw_materials
  from anon;
