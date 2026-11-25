import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, type TestDb } from "./harness";

let db: TestDb;
let owner: string;
let manager: string;
let operator: string;
let viewer: string;
let outsider: string;
let companyA: string;
const unit: Record<string, string> = {};

async function addMember(companyId: string, userId: string, role: string) {
  await db.query(
    `insert into public.company_members (company_id, user_id, role_id)
     select $1, $2, id from public.roles where company_id is null and key = $3`,
    [companyId, userId, role],
  );
}

const createCompany = (userId: string, name: string) =>
  asUser(db, userId, async (tx) => (await tx.query<{ id: string }>("select public.create_company_with_owner($1) as id", [name])).rows[0].id, {
    commit: true,
  });

async function insert(table: string, values: Record<string, unknown>) {
  const cols = Object.keys(values);
  const res = await db.query<{ id: string }>(
    `insert into public.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    Object.values(values),
  );
  return res.rows[0].id;
}

const product = (name: string, unitCode = "un") =>
  insert("products", { company_id: companyA, name, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 6)}`, unit_id: unit[unitCode] });
const raw = (name: string, unitCode: string, density: number | null = null) =>
  insert("raw_materials", { company_id: companyA, name, unit_id: unit[unitCode], density });

/** Entrada de estoque (como o proprietário) com custo por unidade de estoque. */
const stockIn = (itemType: "product" | "raw_material", id: string, qty: number, cost: number | null = null) =>
  asUser(db, owner, (tx) => tx.query("select public.fn_register_stock_movement($1, $2, $3, 'entrada', $4, null, $5)", [randomUUID(), itemType, id, qty, cost]), {
    commit: true,
  });

type Item = { raw_material_id: string; quantity: number; unit_id?: string };

const saveRecipe = (user: string, productId: string, yieldQty: number, loss: number, items: Item[]) =>
  asUser(
    db,
    user,
    async (tx) =>
      (await tx.query<{ r: { recipe_id: string; version: number } }>("select public.fn_save_recipe($1, $2, $3, $4::jsonb) as r", [productId, yieldQty, loss, JSON.stringify(items)])).rows[0].r,
    { commit: true },
  );

const createOrder = (user: string, productId: string, qty: number, opId: string = randomUUID()) =>
  asUser(
    db,
    user,
    async (tx) =>
      (await tx.query<{ r: { order_id: string; number: number; duplicate?: boolean } }>("select public.fn_create_production_order($1, $2, $3) as r", [opId, productId, qty])).rows[0].r,
    { commit: true },
  );

const complete = (user: string, orderId: string, produced: number, items: { raw_material_id: string; quantity: number }[] | null = null, opId: string = randomUUID()) =>
  asUser(
    db,
    user,
    async (tx) =>
      (
        await tx.query<{ r: { status: string; unit_cost: string; cost_complete: boolean; duplicate?: boolean } }>(
          "select public.fn_complete_production_order($1, $2, $3, $4::jsonb) as r",
          [opId, orderId, produced, items ? JSON.stringify(items) : null],
        )
      ).rows[0].r,
    { commit: true },
  );

const reverse = (user: string, orderId: string, reason = "erro de lançamento", opId: string = randomUUID()) =>
  asUser(db, user, async (tx) => (await tx.query<{ r: unknown }>("select public.fn_reverse_production_order($1, $2, $3) as r", [opId, orderId, reason])).rows[0].r, {
    commit: true,
  });

async function qty(column: "product_id" | "raw_material_id", id: string) {
  const r = await db.query<{ quantity: string; avg_cost: string }>(`select quantity::text, avg_cost::text from public.stock_balances where ${column} = $1`, [id]);
  return r.rows[0] ? { quantity: Number(r.rows[0].quantity), avgCost: Number(r.rows[0].avg_cost) } : { quantity: 0, avgCost: 0 };
}

const orderRow = async (id: string) =>
  (await db.query<{ status: string; produced_quantity: string | null; material_cost: string | null; unit_cost: string | null; cost_complete: boolean | null; number: string }>(
    "select status, produced_quantity::text, material_cost::text, unit_cost::text, cost_complete, number::text from public.production_orders where id = $1",
    [id],
  )).rows[0];

beforeAll(async () => {
  db = await createTestDb();
  owner = await createUser(db, "owner@example.com");
  manager = await createUser(db, "manager@example.com");
  operator = await createUser(db, "operator@example.com");
  viewer = await createUser(db, "viewer@example.com");
  outsider = await createUser(db, "outsider@example.com");
  await db.exec("update private.app_config set single_company = false");
  companyA = await createCompany(owner, "Kairós");
  await createCompany(outsider, "Outra");
  await addMember(companyA, manager, "manager");
  await addMember(companyA, operator, "operator");
  await addMember(companyA, viewer, "viewer");
  const units = await db.query<{ id: string; code: string }>("select id, code from public.measurement_units where company_id is null");
  for (const u of units.rows) unit[u.code] = u.id;
}, 60_000);

describe("ficha técnica", () => {
  it("salvar cria versões; só uma fica ativa; versões antigas ficam intactas", async () => {
    const vela = await product("Vela Recipe");
    const cera = await raw("Cera Recipe", "g");
    const v1 = await saveRecipe(owner, vela, 1, 0, [{ raw_material_id: cera, quantity: 180 }]);
    const v2 = await saveRecipe(manager, vela, 1, 5, [{ raw_material_id: cera, quantity: 200 }]);
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    const rows = await db.query<{ version: number; is_active: boolean }>("select version, is_active from public.product_recipes where product_id = $1 order by version", [vela]);
    expect(rows.rows).toEqual([
      { version: 1, is_active: false },
      { version: 2, is_active: true },
    ]);
    const items = await db.query<{ quantity: string }>("select quantity::text from public.recipe_items where recipe_id = $1", [v1.recipe_id]);
    expect(Number(items.rows[0].quantity)).toBe(180);
  });

  it("operador e leitura não editam ficha técnica; API não escreve direto", async () => {
    const p = await product("Vela Perm");
    const m = await raw("Cera Perm", "g");
    for (const u of [operator, viewer, outsider]) {
      await expect(saveRecipe(u, p, 1, 0, [{ raw_material_id: m, quantity: 1 }])).rejects.toThrow(/sem permissão/);
    }
    await expect(
      asUser(db, owner, (tx) => tx.query("insert into public.product_recipes (company_id, product_id, version, yield_quantity) values ($1, $2, 9, 1)", [companyA, p])),
    ).rejects.toThrow(/permission denied/);
  });

  it("recusa insumo repetido, unidade incompatível e lista vazia", async () => {
    const p = await product("Vela Valid");
    const cera = await raw("Cera Valid", "g");
    const pavio = await raw("Pavio Valid", "un");
    await expect(saveRecipe(owner, p, 1, 0, [])).rejects.toThrow(/ao menos uma/);
    await expect(
      saveRecipe(owner, p, 1, 0, [
        { raw_material_id: cera, quantity: 1 },
        { raw_material_id: cera, quantity: 2 },
      ]),
    ).rejects.toThrow(/mais de uma vez/);
    await expect(saveRecipe(owner, p, 1, 0, [{ raw_material_id: pavio, quantity: 1, unit_id: unit.g }])).rejects.toThrow(/Não é possível converter/);
    await expect(saveRecipe(owner, p, 1, 100, [{ raw_material_id: cera, quantity: 1 }])).rejects.toThrow(/Perda prevista/);
  });

  it("versão salva é imutável mesmo para o dono do banco", async () => {
    const p = await product("Vela Imut");
    const m = await raw("Cera Imut", "g");
    const r = await saveRecipe(owner, p, 1, 0, [{ raw_material_id: m, quantity: 10 }]);
    await expect(db.query("update public.product_recipes set yield_quantity = 5 where id = $1", [r.recipe_id])).rejects.toThrow(/imutável/);
    await expect(db.query("update public.recipe_items set quantity = 5 where recipe_id = $1", [r.recipe_id])).rejects.toThrow(/imutável/);
  });

  it("unidade de estoque trava quando o item está em ficha técnica", async () => {
    const p = await product("Vela Unit");
    const m = await raw("Cera Unit", "g");
    await saveRecipe(owner, p, 1, 0, [{ raw_material_id: m, quantity: 10 }]);
    await expect(asUser(db, owner, (tx) => tx.query("update public.products set unit_id = $1 where id = $2", [unit.dz, p]))).rejects.toThrow(/ficha técnica/);
    await expect(asUser(db, owner, (tx) => tx.query("update public.raw_materials set unit_id = $1 where id = $2", [unit.kg, m]))).rejects.toThrow(/ficha técnica/);
  });
});

describe("ordem de produção", () => {
  it("planeja necessidade com conversão de unidade e perda prevista, sem mexer no estoque", async () => {
    const vela = await product("Vela OP");
    const cera = await raw("Cera OP", "kg");
    const essencia = await raw("Essência OP", "ml");
    // rende 4 velas: 800 g de cera (estoque em kg) + 40 ml de essência; perda 10%
    await saveRecipe(owner, vela, 4, 10, [
      { raw_material_id: cera, quantity: 800, unit_id: unit.g },
      { raw_material_id: essencia, quantity: 40 },
    ]);
    const o = await createOrder(operator, vela, 10);
    const items = await db.query<{ raw_material_id: string; planned_quantity: string }>("select raw_material_id, planned_quantity::text from public.production_order_items where order_id = $1", [o.order_id]);
    const planned = Object.fromEntries(items.rows.map((r) => [r.raw_material_id, Number(r.planned_quantity)]));
    expect(planned[cera]).toBeCloseTo(2.2, 6); // 0,8 kg × 10/4 × 1,1
    expect(planned[essencia]).toBeCloseTo(110, 6); // 40 × 2,5 × 1,1
    expect((await qty("raw_material_id", cera)).quantity).toBe(0);
    expect((await orderRow(o.order_id)).status).toBe("planned");
  });

  it("numeração sequencial por empresa", async () => {
    const p = await product("Vela Num");
    const m = await raw("Cera Num", "g");
    await saveRecipe(owner, p, 1, 0, [{ raw_material_id: m, quantity: 1 }]);
    const a = await createOrder(owner, p, 1);
    const b = await createOrder(owner, p, 1);
    expect(Number(b.number)).toBe(Number(a.number) + 1);
  });

  it("sem ficha técnica ativa não abre ordem; leitura não abre", async () => {
    const p = await product("Vela Sem Ficha");
    await expect(createOrder(owner, p, 1)).rejects.toThrow(/ficha técnica ativa/);
    const m = await raw("Cera Sem", "g");
    await saveRecipe(owner, p, 1, 0, [{ raw_material_id: m, quantity: 1 }]);
    await expect(createOrder(viewer, p, 1)).rejects.toThrow(/sem permissão/);
    await asUser(db, owner, (tx) => tx.query("select public.fn_deactivate_recipe($1)", [p]), { commit: true });
    await expect(createOrder(owner, p, 1)).rejects.toThrow(/ficha técnica ativa/);
  });

  it("concluir consome insumos, dá entrada no produto e calcula o custo real", async () => {
    const vela = await product("Vela Custo");
    const cera = await raw("Cera Custo", "g");
    const pavio = await raw("Pavio Custo", "un");
    await stockIn("raw_material", cera, 1000, 0.05); // R$ 0,05/g
    await stockIn("raw_material", pavio, 10, 0.5);
    await saveRecipe(owner, vela, 1, 0, [
      { raw_material_id: cera, quantity: 200 },
      { raw_material_id: pavio, quantity: 1 },
    ]);
    const o = await createOrder(operator, vela, 3);
    // consumo real de cera maior que o planejado (620 g); 3 velas boas
    const r = await complete(operator, o.order_id, 3, [{ raw_material_id: cera, quantity: 620 }]);
    expect(r.status).toBe("completed");
    expect(r.cost_complete).toBe(true);

    expect((await qty("raw_material_id", cera)).quantity).toBe(380);
    expect((await qty("raw_material_id", pavio)).quantity).toBe(7);
    const v = await qty("product_id", vela);
    expect(v.quantity).toBe(3);
    // (620 × 0,05 + 3 × 0,5) / 3 = (31 + 1,5) / 3 = 10,833333
    expect(Number(r.unit_cost)).toBeCloseTo(10.833333, 6);
    expect(v.avgCost).toBeCloseTo(10.833333, 6);
    const row = await orderRow(o.order_id);
    expect(Number(row.material_cost)).toBeCloseTo(32.5, 6);
    const price = await db.query<{ cost_price: string }>("select cost_price::text from public.products where id = $1", [vela]);
    expect(Number(price.rows[0].cost_price)).toBeCloseTo(10.833333, 6);

    const movs = await db.query<{ type: string; source_type: string }>("select type, source_type from public.stock_movements where source_id = $1", [o.order_id]);
    expect(movs.rows.map((m) => m.type).sort()).toEqual(["producao_consumo", "producao_consumo", "producao_entrada"]);
    expect(movs.rows.every((m) => m.source_type === "production_order")).toBe(true);
  });

  it("falta de um insumo: nada é baixado (tudo ou nada)", async () => {
    const vela = await product("Vela Falta");
    const cera = await raw("Cera Falta", "g");
    const pavio = await raw("Pavio Falta", "un");
    await stockIn("raw_material", cera, 1000);
    await stockIn("raw_material", pavio, 1); // precisa de 2
    await saveRecipe(owner, vela, 1, 0, [
      { raw_material_id: cera, quantity: 100 },
      { raw_material_id: pavio, quantity: 1 },
    ]);
    const o = await createOrder(owner, vela, 2);
    await expect(complete(owner, o.order_id, 2)).rejects.toThrow(/Saldo insuficiente/);
    expect((await qty("raw_material_id", cera)).quantity).toBe(1000);
    expect((await qty("raw_material_id", pavio)).quantity).toBe(1);
    expect((await qty("product_id", vela)).quantity).toBe(0);
    expect((await orderRow(o.order_id)).status).toBe("planned");
  });

  it("insumo sem custo conhecido: custo marcado como incompleto e custo médio do produto preservado", async () => {
    const vela = await product("Vela SemCusto");
    const cera = await raw("Cera SemCusto", "g");
    await stockIn("raw_material", cera, 500); // sem custo
    await saveRecipe(owner, vela, 1, 0, [{ raw_material_id: cera, quantity: 100 }]);
    const o = await createOrder(owner, vela, 1);
    const r = await complete(owner, o.order_id, 1);
    expect(r.cost_complete).toBe(false);
    expect((await qty("product_id", vela)).avgCost).toBe(0);
    const price = await db.query<{ cost_price: string | null }>("select cost_price from public.products where id = $1", [vela]);
    expect(price.rows[0].cost_price).toBeNull();
  });

  it("perda na produção: produzido menor que o planejado", async () => {
    const vela = await product("Vela Perda");
    const cera = await raw("Cera Perda", "g");
    await stockIn("raw_material", cera, 1000, 0.1);
    await saveRecipe(owner, vela, 1, 0, [{ raw_material_id: cera, quantity: 100 }]);
    const o = await createOrder(owner, vela, 5);
    const r = await complete(owner, o.order_id, 4); // 1 quebrou
    expect(Number(r.unit_cost)).toBeCloseTo(12.5, 6); // 500 × 0,10 / 4
    const row = await orderRow(o.order_id);
    expect(Number(row.produced_quantity)).toBe(4);
    expect((await qty("product_id", vela)).quantity).toBe(4);
  });

  it("não conclui duas vezes; mesmo id de operação devolve o resultado anterior", async () => {
    const vela = await product("Vela Dupla");
    const cera = await raw("Cera Dupla", "g");
    await stockIn("raw_material", cera, 1000);
    await saveRecipe(owner, vela, 1, 0, [{ raw_material_id: cera, quantity: 100 }]);
    const o = await createOrder(owner, vela, 2);
    const opId = randomUUID();
    await complete(owner, o.order_id, 2, null, opId);
    const again = await complete(owner, o.order_id, 2, null, opId);
    expect(again.duplicate).toBe(true);
    await expect(complete(owner, o.order_id, 2)).rejects.toThrow(/já está concluída/);
    expect((await qty("product_id", vela)).quantity).toBe(2);
    expect((await qty("raw_material_id", cera)).quantity).toBe(800);
  });

  it("consumo para insumo fora da ordem é recusado", async () => {
    const vela = await product("Vela Fora");
    const cera = await raw("Cera Fora", "g");
    const outro = await raw("Outro Fora", "g");
    await stockIn("raw_material", cera, 1000);
    await saveRecipe(owner, vela, 1, 0, [{ raw_material_id: cera, quantity: 100 }]);
    const o = await createOrder(owner, vela, 1);
    await expect(complete(owner, o.order_id, 1, [{ raw_material_id: outro, quantity: 1 }])).rejects.toThrow(/não pertence à ordem/);
  });

  it("cancelar ordem aberta; ordem cancelada não conclui", async () => {
    const vela = await product("Vela Cancel");
    const cera = await raw("Cera Cancel", "g");
    await saveRecipe(owner, vela, 1, 0, [{ raw_material_id: cera, quantity: 1 }]);
    const o = await createOrder(operator, vela, 1);
    await asUser(db, operator, (tx) => tx.query("select public.fn_cancel_production_order($1, 'sem pedido')", [o.order_id]), { commit: true });
    expect((await orderRow(o.order_id)).status).toBe("canceled");
    await expect(complete(owner, o.order_id, 1)).rejects.toThrow(/cancelada/);
  });

  it("estorno devolve insumos e retira o produto, uma única vez e só por gerente+", async () => {
    const vela = await product("Vela Estorno");
    const cera = await raw("Cera Estorno", "g");
    await stockIn("raw_material", cera, 1000, 0.05);
    await saveRecipe(owner, vela, 1, 0, [{ raw_material_id: cera, quantity: 200 }]);
    const o = await createOrder(owner, vela, 2);
    await complete(owner, o.order_id, 2);
    await expect(reverse(operator, o.order_id)).rejects.toThrow(/sem permissão/);
    await reverse(manager, o.order_id);
    expect((await qty("raw_material_id", cera)).quantity).toBe(1000);
    expect((await qty("product_id", vela)).quantity).toBe(0);
    expect((await orderRow(o.order_id)).status).toBe("reversed");
    await expect(reverse(owner, o.order_id)).rejects.toThrow(/Somente ordens concluídas/);

    // movimentações do documento não podem ser estornadas avulsas
    const mov = (await db.query<{ id: string }>("select id from public.stock_movements where source_id = $1 and type = 'producao_entrada'", [o.order_id])).rows[0].id;
    await expect(
      asUser(db, owner, (tx) => tx.query("select public.fn_reverse_stock_movement($1, $2, 'x')", [randomUUID(), mov])),
    ).rejects.toThrow(/pertence a um documento|já estornada/);
  });

  it("estorno recusado se o produto já saiu do estoque (sem saldo negativo)", async () => {
    const vela = await product("Vela Vendida");
    const cera = await raw("Cera Vendida", "g");
    await stockIn("raw_material", cera, 1000);
    await saveRecipe(owner, vela, 1, 0, [{ raw_material_id: cera, quantity: 100 }]);
    const o = await createOrder(owner, vela, 2);
    await complete(owner, o.order_id, 2);
    await asUser(db, owner, (tx) => tx.query("select public.fn_register_stock_movement($1, 'product', $2, 'saida', 2)", [randomUUID(), vela]), { commit: true });
    await expect(reverse(owner, o.order_id)).rejects.toThrow(/Saldo insuficiente/);
    expect((await qty("raw_material_id", cera)).quantity).toBe(800);
    expect((await orderRow(o.order_id)).status).toBe("completed");
  });

  it("tabelas de produção sem escrita pela API; outra empresa não lê", async () => {
    await expect(asUser(db, owner, (tx) => tx.query("update public.production_orders set status = 'completed'"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, owner, (tx) => tx.query("delete from public.production_order_items"))).rejects.toThrow(/permission denied/);
    const r = await asUser(db, outsider, (tx) => tx.query("select id from public.production_orders"));
    expect(r.rows).toHaveLength(0);
    const r2 = await asUser(db, outsider, (tx) => tx.query("select id from public.product_recipes"));
    expect(r2.rows).toHaveLength(0);
  });
});
