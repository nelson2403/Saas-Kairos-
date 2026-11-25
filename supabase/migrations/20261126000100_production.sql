-- =====================================================================
-- SAS KAIRÓS — Fase 3: produção (fichas técnicas e ordens de produção)
--
-- Regras:
--  * Ficha técnica versionada e imutável: salvar = nova versão ativa.
--    Ordens guardam a versão usada, então o histórico nunca muda.
--  * Concluir uma ordem é tudo ou nada: consome TODAS as matérias-primas e
--    dá entrada no produto na mesma transação. Faltou um insumo → nada muda.
--  * Custo da produção = consumo real × custo médio de cada insumo no momento.
--  * Estorno devolve os insumos e retira o produto, uma única vez.
--  * Tabelas sem escrita pela API: só as funções fn_* abaixo gravam.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Numeração sequencial de documentos por empresa (OP-1, OP-2, …)
-- ---------------------------------------------------------------------
create table public.document_sequences (
  company_id  uuid not null references public.companies (id) on delete cascade,
  key         text not null,
  last_value  bigint not null default 0,
  primary key (company_id, key)
);
alter table public.document_sequences enable row level security;
revoke all on public.document_sequences from anon, authenticated;

create or replace function private.next_document_number(p_company_id uuid, p_key text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.document_sequences as s (company_id, key, last_value) values (p_company_id, p_key, 1)
  on conflict (company_id, key) do update set last_value = s.last_value + 1
  returning last_value;
$$;
revoke execute on function private.next_document_number(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Fichas técnicas
-- ---------------------------------------------------------------------
create table public.product_recipes (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  product_id      uuid not null,
  version         int not null check (version > 0),
  -- quanto a receita rende, na unidade de estoque do produto
  yield_quantity  numeric(18, 6) not null check (yield_quantity > 0),
  -- perda prevista do processo: acrescida ao consumo de cada insumo
  loss_percent    numeric(6, 3) not null default 0 check (loss_percent >= 0 and loss_percent < 100),
  notes           text check (notes is null or char_length(notes) <= 2000),
  is_active       boolean not null default true,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (company_id, id),
  unique (product_id, version),
  foreign key (company_id, product_id) references public.products (company_id, id) on delete cascade
);
create unique index product_recipes_active_uq on public.product_recipes (product_id) where is_active;

create table public.recipe_items (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null,
  recipe_id        uuid not null,
  raw_material_id  uuid not null,
  quantity         numeric(18, 6) not null check (quantity > 0), -- por rendimento da receita
  unit_id          uuid not null references public.measurement_units (id),
  sort_order       int not null default 0,
  foreign key (company_id, recipe_id) references public.product_recipes (company_id, id) on delete cascade,
  foreign key (company_id, raw_material_id) references public.raw_materials (company_id, id),
  unique (recipe_id, raw_material_id)
);
create index recipe_items_raw_idx on public.recipe_items (raw_material_id);

-- Versões são imutáveis; só a marcação de ativa muda (pela função).
create or replace function private.recipe_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.product_id, new.version, new.yield_quantity, new.loss_percent, new.notes, new.company_id)
     is distinct from (old.product_id, old.version, old.yield_quantity, old.loss_percent, old.notes, old.company_id) then
    raise exception 'Versão de ficha técnica é imutável; salve uma nova versão' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger product_recipes_guard before update on public.product_recipes
  for each row execute function private.recipe_guard();
create trigger recipe_items_immutable before update on public.recipe_items
  for each row execute function private.forbid_change();

-- A unidade de estoque também fica fixa depois que o item entra numa ficha técnica.
create or replace function private.lock_stock_unit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.unit_id is distinct from old.unit_id and (
    exists (
      select 1 from public.stock_movements s
      where (tg_table_name = 'products' and s.product_id = old.id)
         or (tg_table_name = 'raw_materials' and s.raw_material_id = old.id)
    )
    or (tg_table_name = 'products' and exists (select 1 from public.product_recipes r where r.product_id = old.id))
    or (tg_table_name = 'raw_materials' and exists (select 1 from public.recipe_items i where i.raw_material_id = old.id))
  ) then
    raise exception 'A unidade de estoque não pode ser alterada após movimentações ou uso em ficha técnica'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Custo atual de um insumo por unidade de estoque: custo médio; sem ele, último custo.
create or replace function private.material_cost(p_company_id uuid, p_raw_material_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(b.avg_cost, 0), r.last_cost)
    from public.raw_materials r
    left join public.stock_balances b on b.company_id = r.company_id and b.raw_material_id = r.id
   where r.company_id = p_company_id and r.id = p_raw_material_id;
$$;
revoke execute on function private.material_cost(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- API: salvar ficha técnica (cria nova versão ativa)
--   p_items: [{"raw_material_id": uuid, "quantity": numeric, "unit_id": uuid}, …]
-- ---------------------------------------------------------------------
create or replace function public.fn_save_recipe(
  p_product_id  uuid,
  p_yield       numeric,
  p_loss        numeric,
  p_items       jsonb,
  p_notes       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
  v_version int;
  v_recipe uuid;
  v_item jsonb;
  v_raw public.raw_materials;
  v_qty numeric;
  v_unit uuid;
  v_seen uuid[] := '{}';
  v_order int := 0;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if v_product.id is null or not private.has_company_role(v_product.company_id, array['owner', 'admin', 'manager']) then
    raise exception 'Produto não encontrado ou sem permissão' using errcode = '42501';
  end if;
  if v_product.status = 'archived' then
    raise exception 'Produto arquivado não pode ter ficha técnica' using errcode = 'P0001';
  end if;
  if p_yield is null or p_yield <= 0 then
    raise exception 'Informe o rendimento da receita' using errcode = 'P0001';
  end if;
  if p_loss is null or p_loss < 0 or p_loss >= 100 then
    raise exception 'Perda prevista deve ficar entre 0 e 99,9%%' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Inclua ao menos uma matéria-prima' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'Ficha técnica com itens demais (máximo 100)' using errcode = 'P0001';
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.product_recipes where product_id = p_product_id;
  update public.product_recipes set is_active = false where product_id = p_product_id and is_active;

  insert into public.product_recipes (company_id, product_id, version, yield_quantity, loss_percent, notes, created_by)
  values (v_product.company_id, p_product_id, v_version, p_yield, p_loss, nullif(btrim(p_notes), ''), (select auth.uid()))
  returning id into v_recipe;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_raw from public.raw_materials
     where id = (v_item ->> 'raw_material_id')::uuid and company_id = v_product.company_id;
    if v_raw.id is null then
      raise exception 'Matéria-prima não encontrada' using errcode = 'P0001';
    end if;
    if v_raw.status = 'archived' then
      raise exception '"%" está arquivada', v_raw.name using errcode = 'P0001';
    end if;
    if v_raw.id = any (v_seen) then
      raise exception '"%" aparece mais de uma vez', v_raw.name using errcode = 'P0001';
    end if;
    v_seen := v_seen || v_raw.id;

    v_qty := (v_item ->> 'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantidade inválida para "%"', v_raw.name using errcode = 'P0001';
    end if;
    v_unit := coalesce((v_item ->> 'unit_id')::uuid, v_raw.unit_id);
    -- valida a conversão para a unidade de estoque do insumo (erro em português se impossível)
    perform private.convert_quantity(v_qty, v_unit, v_raw.unit_id, v_raw.density);

    insert into public.recipe_items (company_id, recipe_id, raw_material_id, quantity, unit_id, sort_order)
    values (v_product.company_id, v_recipe, v_raw.id, v_qty, v_unit, v_order);
    v_order := v_order + 1;
  end loop;

  return jsonb_build_object('recipe_id', v_recipe, 'version', v_version);
end;
$$;
revoke execute on function public.fn_save_recipe(uuid, numeric, numeric, jsonb, text) from public, anon;
grant execute on function public.fn_save_recipe(uuid, numeric, numeric, jsonb, text) to authenticated;

-- Desativa a ficha (o produto deixa de poder ser produzido até salvar outra).
create or replace function public.fn_deactivate_recipe(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.products where id = p_product_id;
  if v_company is null or not private.has_company_role(v_company, array['owner', 'admin', 'manager']) then
    raise exception 'Produto não encontrado ou sem permissão' using errcode = '42501';
  end if;
  update public.product_recipes set is_active = false where product_id = p_product_id and is_active;
end;
$$;
revoke execute on function public.fn_deactivate_recipe(uuid) from public, anon;
grant execute on function public.fn_deactivate_recipe(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Ordens de produção
-- ---------------------------------------------------------------------
create table public.production_orders (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  number             bigint not null,
  product_id         uuid not null,
  recipe_id          uuid not null,
  planned_quantity   numeric(18, 6) not null check (planned_quantity > 0),
  produced_quantity  numeric(18, 6) check (produced_quantity is null or produced_quantity > 0),
  status             text not null default 'planned' check (status in ('planned', 'completed', 'canceled', 'reversed')),
  material_cost      numeric(18, 6) check (material_cost is null or material_cost >= 0), -- total consumido
  unit_cost          numeric(18, 6) check (unit_cost is null or unit_cost >= 0),         -- por unidade produzida
  cost_complete      boolean,  -- false se algum insumo consumido não tinha custo conhecido
  notes              text check (notes is null or char_length(notes) <= 2000),
  close_reason       text check (close_reason is null or char_length(close_reason) <= 300),
  created_by         uuid,
  created_at         timestamptz not null default now(),
  completed_by       uuid,
  completed_at       timestamptz,
  closed_by          uuid,
  closed_at          timestamptz,
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, product_id) references public.products (company_id, id),
  foreign key (company_id, recipe_id) references public.product_recipes (company_id, id)
);
create index production_orders_company_idx on public.production_orders (company_id, created_at desc);
create index production_orders_product_idx on public.production_orders (product_id, created_at desc);
create index production_orders_status_idx on public.production_orders (company_id, status);

create table public.production_order_items (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null,
  order_id          uuid not null,
  raw_material_id   uuid not null,
  planned_quantity  numeric(18, 6) not null check (planned_quantity > 0), -- unidade de estoque do insumo
  actual_quantity   numeric(18, 6) check (actual_quantity is null or actual_quantity >= 0),
  unit_cost         numeric(18, 6) check (unit_cost is null or unit_cost >= 0),
  total_cost        numeric(18, 6) check (total_cost is null or total_cost >= 0),
  foreign key (company_id, order_id) references public.production_orders (company_id, id) on delete cascade,
  foreign key (company_id, raw_material_id) references public.raw_materials (company_id, id),
  unique (order_id, raw_material_id)
);

-- Movimentações de um documento (estorno da ordem, histórico).
create index stock_movements_source_idx on public.stock_movements (source_type, source_id) where source_id is not null;

-- ---------------------------------------------------------------------
-- API: abrir ordem de produção (não mexe no estoque)
-- ---------------------------------------------------------------------
create or replace function public.fn_create_production_order(
  p_client_op_id  uuid,
  p_product_id    uuid,
  p_quantity      numeric,
  p_notes         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
  v_recipe public.product_recipes;
  v_existing jsonb;
  v_order uuid;
  v_number bigint;
  v_item record;
  v_qty numeric;
  v_result jsonb;
begin
  select * into v_product from public.products where id = p_product_id;
  if v_product.id is null or not private.has_company_role(v_product.company_id, array['owner', 'admin', 'manager', 'operator']) then
    raise exception 'Produto não encontrado ou sem permissão' using errcode = '42501';
  end if;

  v_existing := private.claim_client_op(v_product.company_id, p_client_op_id);
  if v_existing is not null then
    return v_existing;
  end if;

  if v_product.status = 'archived' then
    raise exception 'Produto arquivado não pode ser produzido' using errcode = 'P0001';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Informe a quantidade a produzir' using errcode = 'P0001';
  end if;
  select * into v_recipe from public.product_recipes where product_id = p_product_id and is_active;
  if v_recipe.id is null then
    raise exception '"%" não tem ficha técnica ativa', v_product.name using errcode = 'P0001';
  end if;

  v_number := private.next_document_number(v_product.company_id, 'production_order');
  insert into public.production_orders (company_id, number, product_id, recipe_id, planned_quantity, notes, created_by)
  values (v_product.company_id, v_number, p_product_id, v_recipe.id, p_quantity, nullif(btrim(p_notes), ''), (select auth.uid()))
  returning id into v_order;

  -- Necessidade de cada insumo: receita × (quantidade / rendimento) × (1 + perda%), na unidade de estoque.
  for v_item in
    select i.raw_material_id, i.quantity, i.unit_id, r.unit_id as stock_unit, r.density, r.name
      from public.recipe_items i
      join public.raw_materials r on r.id = i.raw_material_id
     where i.recipe_id = v_recipe.id
  loop
    v_qty := round(
      private.convert_quantity(v_item.quantity, v_item.unit_id, v_item.stock_unit, v_item.density)
        * p_quantity / v_recipe.yield_quantity * (1 + v_recipe.loss_percent / 100),
      6);
    if v_qty <= 0 then
      raise exception 'Quantidade de "%" pequena demais para a unidade de estoque', v_item.name using errcode = 'P0001';
    end if;
    insert into public.production_order_items (company_id, order_id, raw_material_id, planned_quantity)
    values (v_product.company_id, v_order, v_item.raw_material_id, v_qty);
  end loop;

  v_result := jsonb_build_object('order_id', v_order, 'number', v_number);
  perform private.record_client_op(v_product.company_id, p_client_op_id, 'production.create', v_result);
  return v_result;
end;
$$;
revoke execute on function public.fn_create_production_order(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.fn_create_production_order(uuid, uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- API: concluir ordem (consumo + entrada, tudo ou nada)
--   p_items (opcional): [{"raw_material_id": uuid, "quantity": numeric}] consumo
--   real na unidade de estoque do insumo; ausentes = quantidade planejada.
-- ---------------------------------------------------------------------
create or replace function public.fn_complete_production_order(
  p_client_op_id       uuid,
  p_order_id           uuid,
  p_produced_quantity  numeric,
  p_items              jsonb default null,
  p_notes              text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.production_orders;
  v_product public.products;
  v_existing jsonb;
  v_given jsonb;
  v_item record;
  v_actual numeric;
  v_cost numeric;
  v_total numeric := 0;
  v_complete boolean := true;
  v_unit_cost numeric;
  v_label text;
  v_result jsonb;
begin
  select * into v_order from public.production_orders where id = p_order_id for update;
  if v_order.id is null or not private.has_company_role(v_order.company_id, array['owner', 'admin', 'manager', 'operator']) then
    raise exception 'Ordem não encontrada ou sem permissão' using errcode = '42501';
  end if;

  v_existing := private.claim_client_op(v_order.company_id, p_client_op_id);
  if v_existing is not null then
    return v_existing;
  end if;

  if v_order.status <> 'planned' then
    raise exception 'Ordem % já está %', v_order.number,
      case v_order.status when 'completed' then 'concluída' when 'canceled' then 'cancelada' else 'estornada' end
      using errcode = 'P0002';
  end if;
  if p_produced_quantity is null or p_produced_quantity <= 0 then
    raise exception 'Informe a quantidade produzida' using errcode = 'P0001';
  end if;

  select * into v_product from public.products where id = v_order.product_id;
  if v_product.status = 'archived' then
    raise exception 'Produto arquivado não pode receber produção' using errcode = 'P0001';
  end if;

  -- Consumo informado: só insumos desta ordem, quantidades >= 0.
  v_given := coalesce(p_items, '[]'::jsonb);
  if jsonb_typeof(v_given) <> 'array' then
    raise exception 'Consumo inválido' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_given) e
     where not exists (
       select 1 from public.production_order_items i
        where i.order_id = p_order_id and i.raw_material_id = (e ->> 'raw_material_id')::uuid)
  ) then
    raise exception 'Consumo informado para insumo que não pertence à ordem' using errcode = 'P0001';
  end if;

  v_label := 'OP ' || v_order.number;

  -- Ordem fixa de travamento (por id do insumo) evita deadlock entre ordens simultâneas.
  for v_item in
    select i.id, i.raw_material_id, i.planned_quantity, r.unit_id, r.name
      from public.production_order_items i
      join public.raw_materials r on r.id = i.raw_material_id
     where i.order_id = p_order_id
     order by i.raw_material_id
  loop
    select (e ->> 'quantity')::numeric into v_actual
      from jsonb_array_elements(v_given) e
     where (e ->> 'raw_material_id')::uuid = v_item.raw_material_id
     limit 1;
    v_actual := coalesce(v_actual, v_item.planned_quantity);
    if v_actual < 0 then
      raise exception 'Consumo inválido para "%"', v_item.name using errcode = 'P0001';
    end if;

    v_cost := null;
    if v_actual > 0 then
      -- trava o saldo antes de ler o custo médio
      insert into public.stock_balances (company_id, raw_material_id) values (v_order.company_id, v_item.raw_material_id)
        on conflict (company_id, raw_material_id) where raw_material_id is not null do nothing;
      perform 1 from public.stock_balances
        where company_id = v_order.company_id and raw_material_id = v_item.raw_material_id for update;
      v_cost := private.material_cost(v_order.company_id, v_item.raw_material_id);
      if v_cost is null then
        v_complete := false;
      end if;

      perform private.apply_stock_movement(
        v_order.company_id, 'raw_material', v_item.raw_material_id, 'producao_consumo',
        -v_actual, v_actual, v_item.unit_id, v_cost, null, v_label,
        'production_order', p_order_id
      );
      v_total := v_total + v_actual * coalesce(v_cost, 0);
    end if;

    update public.production_order_items
       set actual_quantity = v_actual,
           unit_cost = v_cost,
           total_cost = case when v_cost is null then null else round(v_actual * v_cost, 6) end
     where id = v_item.id;
  end loop;

  v_unit_cost := round(v_total / p_produced_quantity, 6);

  -- Entrada do produto: com custo só se todos os insumos tinham custo (não distorce o custo médio).
  perform private.apply_stock_movement(
    v_order.company_id, 'product', v_order.product_id, 'producao_entrada',
    p_produced_quantity, p_produced_quantity, v_product.unit_id,
    case when v_complete then v_unit_cost end, null, v_label,
    'production_order', p_order_id
  );

  if v_complete then
    update public.products set cost_price = v_unit_cost where id = v_order.product_id;
  end if;

  update public.production_orders
     set status = 'completed',
         produced_quantity = p_produced_quantity,
         material_cost = round(v_total, 6),
         unit_cost = v_unit_cost,
         cost_complete = v_complete,
         notes = coalesce(nullif(btrim(p_notes), ''), notes),
         completed_by = (select auth.uid()),
         completed_at = now()
   where id = p_order_id;

  v_result := jsonb_build_object(
    'order_id', p_order_id, 'number', v_order.number, 'status', 'completed',
    'unit_cost', v_unit_cost, 'cost_complete', v_complete
  );
  perform private.record_client_op(v_order.company_id, p_client_op_id, 'production.complete', v_result);
  return v_result;
end;
$$;
revoke execute on function public.fn_complete_production_order(uuid, uuid, numeric, jsonb, text) from public, anon;
grant execute on function public.fn_complete_production_order(uuid, uuid, numeric, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- API: cancelar ordem ainda não concluída (sem efeito no estoque)
-- ---------------------------------------------------------------------
create or replace function public.fn_cancel_production_order(p_order_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.production_orders;
begin
  select * into v_order from public.production_orders where id = p_order_id for update;
  if v_order.id is null or not private.has_company_role(v_order.company_id, array['owner', 'admin', 'manager', 'operator']) then
    raise exception 'Ordem não encontrada ou sem permissão' using errcode = '42501';
  end if;
  if v_order.status <> 'planned' then
    raise exception 'Somente ordens em aberto podem ser canceladas' using errcode = 'P0001';
  end if;
  update public.production_orders
     set status = 'canceled', close_reason = nullif(btrim(p_reason), ''),
         closed_by = (select auth.uid()), closed_at = now()
   where id = p_order_id;
end;
$$;
revoke execute on function public.fn_cancel_production_order(uuid, text) from public, anon;
grant execute on function public.fn_cancel_production_order(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- API: estornar ordem concluída (devolve insumos, retira o produto)
-- ---------------------------------------------------------------------
create or replace function public.fn_reverse_production_order(
  p_client_op_id  uuid,
  p_order_id      uuid,
  p_reason        text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.production_orders;
  v_existing jsonb;
  v_mov record;
  v_result jsonb;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Informe o motivo do estorno' using errcode = 'P0001';
  end if;

  select * into v_order from public.production_orders where id = p_order_id for update;
  if v_order.id is null or not private.has_company_role(v_order.company_id, array['owner', 'admin', 'manager']) then
    raise exception 'Ordem não encontrada ou sem permissão' using errcode = '42501';
  end if;

  v_existing := private.claim_client_op(v_order.company_id, p_client_op_id);
  if v_existing is not null then
    return v_existing;
  end if;

  if v_order.status <> 'completed' then
    raise exception 'Somente ordens concluídas podem ser estornadas' using errcode = 'P0002';
  end if;

  for v_mov in
    select m.* from public.stock_movements m
     where m.source_type = 'production_order' and m.source_id = p_order_id
       and m.type in ('producao_consumo', 'producao_entrada')
       and not exists (select 1 from public.stock_movements r where r.reversal_of = m.id)
     order by coalesce(m.product_id, m.raw_material_id)
  loop
    perform private.apply_stock_movement(
      v_order.company_id,
      case when v_mov.product_id is not null then 'product' else 'raw_material' end,
      coalesce(v_mov.product_id, v_mov.raw_material_id),
      'estorno', -v_mov.quantity, -v_mov.input_quantity, v_mov.input_unit_id,
      null, p_reason, 'OP ' || v_order.number,
      'production_order', p_order_id, v_mov.id
    );
  end loop;

  update public.production_orders
     set status = 'reversed', close_reason = btrim(p_reason),
         closed_by = (select auth.uid()), closed_at = now()
   where id = p_order_id;

  v_result := jsonb_build_object('order_id', p_order_id, 'number', v_order.number, 'status', 'reversed');
  perform private.record_client_op(v_order.company_id, p_client_op_id, 'production.reverse', v_result);
  return v_result;
end;
$$;
revoke execute on function public.fn_reverse_production_order(uuid, uuid, text) from public, anon;
grant execute on function public.fn_reverse_production_order(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
create trigger product_recipes_audit after insert or update on public.product_recipes
  for each row execute function private.audit_row();
create trigger production_orders_audit after insert or update on public.production_orders
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------
-- RLS: leitura para membros; escrita somente pelas funções
-- ---------------------------------------------------------------------
alter table public.product_recipes         enable row level security;
alter table public.recipe_items            enable row level security;
alter table public.production_orders       enable row level security;
alter table public.production_order_items  enable row level security;

create policy product_recipes_select on public.product_recipes for select to authenticated
  using (private.is_company_member(company_id));
create policy recipe_items_select on public.recipe_items for select to authenticated
  using (private.is_company_member(company_id));
create policy production_orders_select on public.production_orders for select to authenticated
  using (private.is_company_member(company_id));
create policy production_order_items_select on public.production_order_items for select to authenticated
  using (private.is_company_member(company_id));

revoke insert, update, delete, truncate on
  public.product_recipes, public.recipe_items, public.production_orders, public.production_order_items
  from anon, authenticated;
