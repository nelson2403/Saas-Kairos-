import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, type TestDb } from "./harness";

let db: TestDb;
let owner: string;
let operator: string;
let viewer: string;
let outsider: string; // proprietário de outra empresa
let companyA: string;
let companyB: string;
const unit: Record<string, string> = {};

async function addMember(companyId: string, userId: string, role: string) {
  await db.query(
    `insert into public.company_members (company_id, user_id, role_id)
     select $1, $2, id from public.roles where company_id is null and key = $3`,
    [companyId, userId, role],
  );
}

async function createCompany(userId: string, name: string) {
  return asUser(
    db,
    userId,
    async (tx) => (await tx.query<{ id: string }>("select public.create_company_with_owner($1) as id", [name])).rows[0].id,
    { commit: true },
  );
}

async function createProduct(name: string, unitCode = "un", extra: Record<string, unknown> = {}) {
  const cols = ["company_id", "name", "slug", "unit_id", ...Object.keys(extra)];
  const vals = [companyA, name, name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), unit[unitCode], ...Object.values(extra)];
  return asUser(
    db,
    owner,
    async (tx) =>
      (
        await tx.query<{ id: string }>(
          `insert into public.products (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
          vals,
        )
      ).rows[0].id,
    { commit: true },
  );
}

async function createRaw(name: string, unitCode: string, density: number | null = null) {
  return asUser(
    db,
    owner,
    async (tx) =>
      (
        await tx.query<{ id: string }>(
          "insert into public.raw_materials (company_id, name, unit_id, density) values ($1, $2, $3, $4) returning id",
          [companyA, name, unit[unitCode], density],
        )
      ).rows[0].id,
    { commit: true },
  );
}

type MoveArgs = {
  user?: string;
  opId?: string | null;
  itemType?: "product" | "raw_material";
  itemId: string;
  type: string;
  quantity: number | string;
  unitCode?: string;
  unitCost?: number | null;
  reason?: string | null;
};

function move(a: MoveArgs) {
  return asUser(
    db,
    a.user ?? owner,
    async (tx) =>
      (
        await tx.query<{ r: { movement_id: string; balance_after: string; duplicate?: boolean } }>(
          "select public.fn_register_stock_movement($1, $2, $3, $4, $5, $6, $7, $8) as r",
          [
            a.opId === undefined ? randomUUID() : a.opId,
            a.itemType ?? "product",
            a.itemId,
            a.type,
            a.quantity,
            a.unitCode ? unit[a.unitCode] : null,
            a.unitCost ?? null,
            a.reason ?? null,
          ],
        )
      ).rows[0].r,
    { commit: true },
  );
}

async function balance(column: "product_id" | "raw_material_id", id: string) {
  const res = await db.query<{ quantity: string; avg_cost: string }>(
    `select quantity::text, avg_cost::text from public.stock_balances where ${column} = $1`,
    [id],
  );
  return res.rows[0] ? { quantity: Number(res.rows[0].quantity), avgCost: Number(res.rows[0].avg_cost) } : null;
}

beforeAll(async () => {
  db = await createTestDb();
  owner = await createUser(db, "owner@example.com");
  operator = await createUser(db, "operator@example.com");
  viewer = await createUser(db, "viewer@example.com");
  outsider = await createUser(db, "outsider@example.com");
  await db.exec("update private.app_config set single_company = false");
  companyA = await createCompany(owner, "Kairós");
  companyB = await createCompany(outsider, "Outra");
  await addMember(companyA, operator, "operator");
  await addMember(companyA, viewer, "viewer");
  const units = await db.query<{ id: string; code: string }>("select id, code from public.measurement_units where company_id is null");
  for (const u of units.rows) unit[u.code] = u.id;
}, 60_000);

describe("cadastros", () => {
  it("proprietário cadastra produto; operador e leitura não", async () => {
    await createProduct("Vela Âmbar");
    for (const user of [operator, viewer]) {
      await expect(
        asUser(db, user, (tx) =>
          tx.query("insert into public.products (company_id, name, slug, unit_id) values ($1, 'X', 'x', $2)", [
            companyA,
            unit.un,
          ]),
        ),
      ).rejects.toThrow(/row-level security/);
    }
  });

  it("SKU é único por empresa (sem diferenciar maiúsculas)", async () => {
    await createProduct("Vela Cedro", "un", { sku: "VEL-001" });
    await expect(createProduct("Vela Cedro 2", "un", { sku: "vel-001" })).rejects.toThrow(/duplicate key/);
  });

  it("outra empresa não vê os produtos", async () => {
    const res = await asUser(db, outsider, (tx) => tx.query("select id from public.products"));
    expect(res.rows).toHaveLength(0);
  });

  it("categoria não pode ser ancestral de si mesma", async () => {
    await expect(
      asUser(db, owner, async (tx) => {
        const a = (await tx.query<{ id: string }>("insert into public.product_categories (company_id, name) values ($1, 'A') returning id", [companyA])).rows[0].id;
        const b = (await tx.query<{ id: string }>("insert into public.product_categories (company_id, name, parent_id) values ($1, 'B', $2) returning id", [companyA, a])).rows[0].id;
        await tx.query("update public.product_categories set parent_id = $1 where id = $2", [b, a]);
      }),
    ).rejects.toThrow(/si mesma/);
  });

  it("produto não aponta para categoria de outra empresa", async () => {
    const catB = await asUser(
      db,
      outsider,
      async (tx) =>
        (await tx.query<{ id: string }>("insert into public.product_categories (company_id, name) values ($1, 'B') returning id", [companyB])).rows[0].id,
      { commit: true },
    );
    await expect(createProduct("Vela Cruzada", "un", { category_id: catB })).rejects.toThrow(/foreign key/);
  });
});

describe("movimentações", () => {
  let vela: string;
  beforeAll(async () => {
    vela = await createProduct("Vela Lavanda");
  });

  it("entrada soma ao saldo e define o custo médio", async () => {
    const r = await move({ itemId: vela, type: "entrada", quantity: 10, unitCost: 12 });
    expect(Number(r.balance_after)).toBe(10);
    expect(await balance("product_id", vela)).toEqual({ quantity: 10, avgCost: 12 });
  });

  it("custo médio é ponderado em novas entradas", async () => {
    await move({ itemId: vela, type: "entrada", quantity: 10, unitCost: 18 });
    expect(await balance("product_id", vela)).toEqual({ quantity: 20, avgCost: 15 });
  });

  it("saída subtrai; saldo insuficiente é recusado sem alterar nada", async () => {
    await move({ itemId: vela, type: "saida", quantity: 5, user: operator });
    await expect(move({ itemId: vela, type: "saida", quantity: 16 })).rejects.toThrow(/Saldo insuficiente/);
    expect((await balance("product_id", vela))?.quantity).toBe(15);
  });

  it("perda e ajuste exigem motivo", async () => {
    await expect(move({ itemId: vela, type: "perda", quantity: 1 })).rejects.toThrow(/motivo/);
    await move({ itemId: vela, type: "perda", quantity: 1, reason: "Quebrou" });
    await move({ itemId: vela, type: "ajuste", quantity: -2, reason: "Conferência" });
    expect((await balance("product_id", vela))?.quantity).toBe(12);
  });

  it("a mesma operação (mesmo id) nunca é aplicada duas vezes", async () => {
    const opId = randomUUID();
    const first = await move({ opId, itemId: vela, type: "entrada", quantity: 3 });
    const second = await move({ opId, itemId: vela, type: "entrada", quantity: 3 });
    expect(second.duplicate).toBe(true);
    expect(second.movement_id).toBe(first.movement_id);
    expect((await balance("product_id", vela))?.quantity).toBe(15);
  });

  it("leitura e outras empresas não movimentam", async () => {
    await expect(move({ itemId: vela, type: "entrada", quantity: 1, user: viewer })).rejects.toThrow(/sem permissão/);
    await expect(move({ itemId: vela, type: "entrada", quantity: 1, user: outsider })).rejects.toThrow(/sem permissão/);
  });

  it("saldos e movimentações não aceitam escrita direta pela API", async () => {
    await expect(
      asUser(db, owner, (tx) => tx.query("update public.stock_balances set quantity = 999 where product_id = $1", [vela])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, owner, (tx) =>
        tx.query(
          `insert into public.stock_movements (company_id, product_id, type, quantity, input_quantity, input_unit_id, balance_before, balance_after)
           values ($1, $2, 'entrada', 1, 1, $3, 0, 1)`,
          [companyA, vela, unit.un],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("movimentação é imutável até para o servidor", async () => {
    await expect(db.query("update public.stock_movements set quantity = 1 where product_id = $1", [vela])).rejects.toThrow(/imutável/);
    await expect(db.query("delete from public.stock_movements where product_id = $1", [vela])).rejects.toThrow(/imutável/);
  });

  it("saldo é sempre igual à soma das movimentações", async () => {
    const res = await db.query<{ sum: string; last: string }>(
      `select sum(quantity)::text as sum,
              (select balance_after::text from public.stock_movements where product_id = $1 order by created_at desc, id desc limit 1) as last
       from public.stock_movements where product_id = $1`,
      [vela],
    );
    expect(Number(res.rows[0].sum)).toBe((await balance("product_id", vela))?.quantity);
  });

  it("unidade de estoque não muda depois de movimentar", async () => {
    await expect(
      asUser(db, owner, (tx) => tx.query("update public.products set unit_id = $1 where id = $2", [unit.kg, vela])),
    ).rejects.toThrow(/unidade de estoque/);
  });

  it("estoque negativo só quando a empresa permite", async () => {
    const p = await createProduct("Vela Negativa");
    await expect(move({ itemId: p, type: "saida", quantity: 1 })).rejects.toThrow(/Saldo insuficiente/);
    await db.query("update public.companies set settings = settings || '{\"allow_negative_stock\": true}' where id = $1", [companyA]);
    await move({ itemId: p, type: "saida", quantity: 1 });
    expect((await balance("product_id", p))?.quantity).toBe(-1);
    await db.query("update public.companies set settings = settings - 'allow_negative_stock' where id = $1", [companyA]);
  });
});

describe("unidades e conversões", () => {
  it("entrada em kg vira gramas na unidade de estoque, com custo convertido", async () => {
    const cera = await createRaw("Cera de soja", "g");
    await move({ itemType: "raw_material", itemId: cera, type: "entrada", quantity: 2, unitCode: "kg", unitCost: 50 });
    expect(await balance("raw_material_id", cera)).toEqual({ quantity: 2000, avgCost: 0.05 });
    const mov = await db.query<{ input_quantity: string; quantity: string }>(
      "select input_quantity::text, quantity::text from public.stock_movements where raw_material_id = $1",
      [cera],
    );
    expect(mov.rows.map((r) => [Number(r.input_quantity), Number(r.quantity)])).toEqual([[2, 2000]]);
    const last = await db.query<{ last_cost: string }>("select last_cost::text from public.raw_materials where id = $1", [cera]);
    expect(Number(last.rows[0].last_cost)).toBe(0.05);
  });

  it("volume para massa só com densidade cadastrada", async () => {
    const semDensidade = await createRaw("Essência sem densidade", "g");
    await expect(
      move({ itemType: "raw_material", itemId: semDensidade, type: "entrada", quantity: 1, unitCode: "l" }),
    ).rejects.toThrow(/converter/);

    const essencia = await createRaw("Essência", "g", 0.9);
    await move({ itemType: "raw_material", itemId: essencia, type: "entrada", quantity: 1, unitCode: "l" });
    expect((await balance("raw_material_id", essencia))?.quantity).toBe(900);
  });

  it("dimensões incompatíveis são recusadas", async () => {
    const pavio = await createRaw("Pavio", "m");
    await expect(move({ itemType: "raw_material", itemId: pavio, type: "entrada", quantity: 1, unitCode: "kg" })).rejects.toThrow(/converter/);
  });
});

describe("estorno", () => {
  let p: string;
  let saida: string;
  beforeAll(async () => {
    p = await createProduct("Vela Estorno");
    await move({ itemId: p, type: "entrada", quantity: 10 });
    saida = (await move({ itemId: p, type: "saida", quantity: 4 })).movement_id;
  });

  const reverse = (movementId: string, user = owner, reason = "Lançado errado") =>
    asUser(db, user, (tx) => tx.query("select public.fn_reverse_stock_movement($1, $2, $3)", [randomUUID(), movementId, reason]), {
      commit: true,
    });

  it("operador não estorna", async () => {
    await expect(reverse(saida, operator)).rejects.toThrow(/sem permissão/);
  });

  it("estorno devolve o saldo e referencia a original", async () => {
    await reverse(saida);
    expect((await balance("product_id", p))?.quantity).toBe(10);
    const res = await db.query<{ type: string; quantity: string }>(
      "select type, quantity::text from public.stock_movements where reversal_of = $1",
      [saida],
    );
    expect(res.rows).toEqual([{ type: "estorno", quantity: "4.000000" }]);
  });

  it("não estorna duas vezes nem estorna um estorno", async () => {
    await expect(reverse(saida)).rejects.toThrow(/já estornada/);
    const est = await db.query<{ id: string }>("select id from public.stock_movements where reversal_of = $1", [saida]);
    await expect(reverse(est.rows[0].id)).rejects.toThrow(/não pode ser estornado/);
  });

  it("estorno de entrada já consumida é recusado (saldo ficaria negativo)", async () => {
    const q = await createProduct("Vela Consumida");
    const entrada = (await move({ itemId: q, type: "entrada", quantity: 5 })).movement_id;
    await move({ itemId: q, type: "saida", quantity: 5 });
    await expect(reverse(entrada)).rejects.toThrow(/Saldo insuficiente/);
  });
});

describe("inventário", () => {
  let p: string;
  let countId: string;
  beforeAll(async () => {
    p = await createProduct("Vela Inventário");
    await move({ itemId: p, type: "entrada", quantity: 8 });
    countId = await asUser(
      db,
      owner,
      async (tx) => (await tx.query<{ id: string }>("select public.fn_create_inventory_count('products') as id")).rows[0].id,
      { commit: true },
    );
  });

  it("abre a contagem com o saldo do sistema", async () => {
    const res = await db.query<{ expected_quantity: string }>(
      "select expected_quantity::text from public.inventory_count_items where count_id = $1 and product_id = $2",
      [countId, p],
    );
    expect(Number(res.rows[0].expected_quantity)).toBe(8);
  });

  it("operador registra a contagem, mas não altera o saldo esperado", async () => {
    await asUser(
      db,
      operator,
      (tx) => tx.query("update public.inventory_count_items set counted_quantity = 6 where count_id = $1 and product_id = $2", [countId, p]),
      { commit: true },
    );
    await expect(
      asUser(db, operator, (tx) => tx.query("update public.inventory_count_items set expected_quantity = 0 where count_id = $1", [countId])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, operator, (tx) => tx.query("select public.fn_apply_inventory_count($1)", [countId])),
    ).rejects.toThrow(/sem permissão/);
  });

  it("aplicar gera ajuste só na diferença, de forma transacional", async () => {
    const res = await asUser(
      db,
      owner,
      async (tx) => (await tx.query<{ r: { adjusted: number } }>("select public.fn_apply_inventory_count($1) as r", [countId])).rows[0].r,
      { commit: true },
    );
    expect((await balance("product_id", p))?.quantity).toBe(6);
    const adj = await db.query<{ quantity: string; source_type: string }>(
      "select quantity::text, source_type from public.stock_movements where source_id = $1 and product_id = $2",
      [countId, p],
    );
    expect(adj.rows).toEqual([{ quantity: "-2.000000", source_type: "inventory_count" }]);
    expect(res.adjusted).toBeGreaterThanOrEqual(1);
  });

  it("contagem aplicada não é reaplicada nem editada; ajuste de inventário não é estornado avulso", async () => {
    await expect(asUser(db, owner, (tx) => tx.query("select public.fn_apply_inventory_count($1)", [countId]))).rejects.toThrow(/encerrada/);
    await expect(
      asUser(db, operator, (tx) => tx.query("update public.inventory_count_items set counted_quantity = 1 where count_id = $1", [countId])),
    ).rejects.toThrow(/encerrada/);
    const adj = await db.query<{ id: string }>("select id from public.stock_movements where source_id = $1 limit 1", [countId]);
    await expect(
      asUser(db, owner, (tx) => tx.query("select public.fn_reverse_stock_movement($1, $2, 'x')", [randomUUID(), adj.rows[0].id])),
    ).rejects.toThrow(/documento/);
  });
});

describe("visão de estoque", () => {
  it("sinaliza itens abaixo do mínimo e respeita a empresa", async () => {
    const p = await createProduct("Vela Mínimo", "un", { min_stock: 5 });
    await move({ itemId: p, type: "entrada", quantity: 3 });
    const mine = await asUser(db, owner, (tx) =>
      tx.query<{ below_min: boolean }>("select below_min from public.stock_overview where item_id = $1", [p]),
    );
    expect(mine.rows).toEqual([{ below_min: true }]);
    const other = await asUser(db, outsider, (tx) => tx.query("select 1 from public.stock_overview"));
    expect(other.rows).toHaveLength(0);
  });
});
