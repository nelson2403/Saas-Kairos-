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
let companyB: string;
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

/** Insere como o usuário (passa por RLS). */
const insertAs = (user: string, table: string, values: Record<string, unknown>) =>
  asUser(
    db,
    user,
    async (tx) => {
      const cols = Object.keys(values);
      const r = await tx.query<{ id: string }>(
        `insert into public.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
        Object.values(values),
      );
      return r.rows[0].id;
    },
    { commit: true },
  );

const customer = (user: string, values: Record<string, unknown> = {}) => insertAs(user, "customers", { company_id: companyA, name: "Maria Silva", ...values });
const supplier = (values: Record<string, unknown> = {}) => insertAs(owner, "suppliers", { company_id: companyA, name: "Ceras Brasil", ...values });
const raw = (name: string, unitCode: string) => insertAs(owner, "raw_materials", { company_id: companyA, name, unit_id: unit[unitCode] });
const product = (name: string) => insertAs(owner, "products", { company_id: companyA, name, slug: randomUUID(), unit_id: unit.un });

type Line = { item_type: "product" | "raw_material"; item_id: string; quantity: number; unit_id?: string; unit_price: number };

const saveOrder = (user: string, supplierId: string, items: Line[], orderId: string | null = null, opId: string = randomUUID()) =>
  asUser(
    db,
    user,
    async (tx) =>
      (
        await tx.query<{ r: { order_id: string; number: number; duplicate?: boolean } }>(
          "select public.fn_save_purchase_order($1, $2, $3, null, null, $4::jsonb) as r",
          [opId, orderId, supplierId, JSON.stringify(items)],
        )
      ).rows[0].r,
    { commit: true },
  );

const orderItems = async (orderId: string) =>
  (await db.query<{ id: string; product_id: string | null; raw_material_id: string | null; received_quantity: string }>(
    "select id, product_id, raw_material_id, received_quantity::text from public.purchase_order_items where order_id = $1 order by sort_order",
    [orderId],
  )).rows;

const receive = (user: string, orderId: string, items: { order_item_id: string; quantity: number; unit_price?: number }[], opId: string = randomUUID()) =>
  asUser(
    db,
    user,
    async (tx) =>
      (
        await tx.query<{ r: { receipt_id: string; status: string; duplicate?: boolean } }>(
          "select public.fn_receive_purchase($1, $2, $3::jsonb, 'NF 123') as r",
          [opId, orderId, JSON.stringify(items)],
        )
      ).rows[0].r,
    { commit: true },
  );

const reverseReceipt = (user: string, receiptId: string, opId: string = randomUUID()) =>
  asUser(db, user, (tx) => tx.query("select public.fn_reverse_purchase_receipt($1, $2, 'nota errada')", [opId, receiptId]), { commit: true });

const setStatus = (user: string, orderId: string, status: string) =>
  asUser(db, user, (tx) => tx.query("select public.fn_set_purchase_order_status($1, $2, 'motivo')", [orderId, status]), { commit: true });

async function stock(column: "product_id" | "raw_material_id", id: string) {
  const r = await db.query<{ quantity: string; avg_cost: string }>(`select quantity::text, avg_cost::text from public.stock_balances where ${column} = $1`, [id]);
  return r.rows[0] ? { quantity: Number(r.rows[0].quantity), avgCost: Number(r.rows[0].avg_cost) } : { quantity: 0, avgCost: 0 };
}

const orderStatus = async (id: string) =>
  (await db.query<{ status: string; total: string }>("select status, total::text from public.purchase_orders where id = $1", [id])).rows[0];

beforeAll(async () => {
  db = await createTestDb();
  owner = await createUser(db, "owner@example.com");
  manager = await createUser(db, "manager@example.com");
  operator = await createUser(db, "operator@example.com");
  viewer = await createUser(db, "viewer@example.com");
  outsider = await createUser(db, "outsider@example.com");
  await db.exec("update private.app_config set single_company = false");
  companyA = await createCompany(owner, "Kairós");
  companyB = await createCompany(outsider, "Outra");
  await addMember(companyA, manager, "manager");
  await addMember(companyA, operator, "operator");
  await addMember(companyA, viewer, "viewer");
  const units = await db.query<{ id: string; code: string }>("select id, code from public.measurement_units where company_id is null");
  for (const u of units.rows) unit[u.code] = u.id;
}, 60_000);

describe("clientes e LGPD", () => {
  it("operador cadastra; leitura não; outra empresa não vê", async () => {
    await customer(operator, { document: "52998224725" });
    await expect(customer(viewer)).rejects.toThrow(/row-level security/);
    const r = await asUser(db, outsider, (tx) => tx.query("select id from public.customers"));
    expect(r.rows).toHaveLength(0);
  });

  it("CPF único por empresa", async () => {
    await customer(owner, { document: "11144477735" });
    await expect(customer(owner, { document: "11144477735" })).rejects.toThrow(/duplicate key/);
  });

  it("consentimento: data carimbada pelo banco e histórico de concessão/revogação", async () => {
    const id = await customer(operator, { whatsapp_opt_in: true, whatsapp_opt_in_at: "2000-01-01" });
    const c = (await db.query<{ whatsapp_opt_in_at: Date }>("select whatsapp_opt_in_at from public.customers where id = $1", [id])).rows[0];
    expect(new Date(c.whatsapp_opt_in_at).getFullYear()).toBeGreaterThan(2000); // não aceita data forjada
    await asUser(db, operator, (tx) => tx.query("update public.customers set whatsapp_opt_in = false, marketing_opt_in = true where id = $1", [id]), { commit: true });
    const log = await db.query<{ channel: string; granted: boolean; recorded_by: string }>(
      "select channel, granted, recorded_by from public.customer_consents where customer_id = $1 order by created_at, channel",
      [id],
    );
    expect(log.rows.map((l) => `${l.channel}:${l.granted}`).sort()).toEqual(["marketing:true", "whatsapp:false", "whatsapp:true"]);
    expect(log.rows.every((l) => l.recorded_by === operator)).toBe(true);
    await expect(db.query("delete from public.customer_consents where customer_id = $1", [id])).rejects.toThrow(/imutável/);
  });

  it("auditoria não guarda dados pessoais em claro", async () => {
    const id = await customer(owner, { name: "João Pessoal", document: "39053344705", email: "joao@exemplo.com", phone: "11987654321" });
    await asUser(db, owner, (tx) => tx.query("update public.customers set phone = '11900000000' where id = $1", [id]), { commit: true });
    const logs = await db.query<{ changes: unknown }>("select changes from public.audit_logs where entity = 'customers' and entity_id = $1", [id]);
    const text = JSON.stringify(logs.rows);
    expect(logs.rows.length).toBe(2);
    for (const secret of ["39053344705", "joao@exemplo.com", "11987654321", "11900000000", "João Pessoal"]) expect(text).not.toContain(secret);
  });

  it("anonimização: só proprietário/admin, apaga dados pessoais e bloqueia edição", async () => {
    const id = await customer(operator, { name: "Ana Titular", document: "86288366757", email: "ana@exemplo.com", marketing_opt_in: true });
    const anon = (user: string) => asUser(db, user, (tx) => tx.query("select public.fn_anonymize_customer($1, 'solicitação da titular')", [id]), { commit: true });
    await expect(anon(manager)).rejects.toThrow(/sem permissão/);
    await anon(owner);
    const c = (await db.query("select name, document, email, marketing_opt_in, anonymized_at, status from public.customers where id = $1", [id])).rows[0] as Record<string, unknown>;
    expect(c).toMatchObject({ name: "Cliente anonimizado", document: null, email: null, marketing_opt_in: false, status: "inactive" });
    expect(c.anonymized_at).not.toBeNull();
    await expect(asUser(db, owner, (tx) => tx.query("update public.customers set name = 'Volta' where id = $1", [id]))).rejects.toThrow(/anonimizado/);
    await expect(anon(owner)).rejects.toThrow(/já anonimizado/);
    const revoked = await db.query("select 1 from public.customer_consents where customer_id = $1 and source = 'anonimizacao' and not granted", [id]);
    expect(revoked.rowCount).toBe(1);
  });

  it("usuário não marca anonimização direto nem exclui cliente", async () => {
    const id = await customer(owner);
    await asUser(db, owner, (tx) => tx.query("update public.customers set anonymized_at = now() where id = $1", [id]), { commit: true });
    const c = (await db.query<{ anonymized_at: Date | null }>("select anonymized_at from public.customers where id = $1", [id])).rows[0];
    expect(c.anonymized_at).toBeNull();
    await expect(asUser(db, owner, (tx) => tx.query("delete from public.customers where id = $1", [id]))).rejects.toThrow(/permission denied/);
  });
});

describe("fornecedores", () => {
  it("gerente cadastra; operador não", async () => {
    await insertAs(manager, "suppliers", { company_id: companyA, name: "Pavios SA" });
    await expect(insertAs(operator, "suppliers", { company_id: companyA, name: "X" })).rejects.toThrow(/row-level security/);
  });

  it("fornecedor preferencial da matéria-prima não cruza empresas", async () => {
    const s = await supplier();
    const m = await raw("Cera Pref", "g");
    await asUser(db, owner, (tx) => tx.query("update public.raw_materials set preferred_supplier_id = $1 where id = $2", [s, m]), { commit: true });
    const other = await insertAs(outsider, "suppliers", { company_id: companyB, name: "Fornecedor B" });
    await expect(db.query("update public.raw_materials set preferred_supplier_id = $1 where id = $2", [other, m])).rejects.toThrow(/foreign key/);
  });
});

describe("compras e recebimentos", () => {
  it("pedido: numeração, total, unidade de compra diferente do estoque; operador não cria", async () => {
    const s = await supplier();
    const cera = await raw("Cera PC", "g");
    const a = await saveOrder(manager, s, [{ item_type: "raw_material", item_id: cera, quantity: 5, unit_id: unit.kg, unit_price: 42.5 }]);
    const b = await saveOrder(owner, s, [{ item_type: "raw_material", item_id: cera, quantity: 1, unit_price: 0.05 }]);
    expect(Number(b.number)).toBe(Number(a.number) + 1);
    expect(await orderStatus(a.order_id)).toEqual({ status: "draft", total: "212.50" });
    await expect(saveOrder(operator, s, [{ item_type: "raw_material", item_id: cera, quantity: 1, unit_price: 1 }])).rejects.toThrow(/Sem permissão/);
    const pavio = await raw("Pavio PC", "un");
    await expect(saveOrder(owner, s, [{ item_type: "raw_material", item_id: pavio, quantity: 1, unit_id: unit.kg, unit_price: 1 }])).rejects.toThrow(/converter/);
  });

  it("recebimento parcial e total: estoque em g, custo por g, último custo e situação", async () => {
    const s = await supplier();
    const cera = await raw("Cera Rec", "g");
    const vela = await product("Vela Revenda");
    const o = await saveOrder(owner, s, [
      { item_type: "raw_material", item_id: cera, quantity: 5, unit_id: unit.kg, unit_price: 40 },
      { item_type: "product", item_id: vela, quantity: 10, unit_price: 12 },
    ]);
    await setStatus(owner, o.order_id, "ordered");
    const [iCera, iVela] = await orderItems(o.order_id);

    const r1 = await receive(operator, o.order_id, [{ order_item_id: iCera.id, quantity: 2 }]);
    expect(r1.status).toBe("partial");
    const sc = await stock("raw_material_id", cera);
    expect(sc.quantity).toBe(2000);
    expect(sc.avgCost).toBeCloseTo(0.04, 6); // R$ 40/kg = R$ 0,04/g
    const last = await db.query<{ last_cost: string }>("select last_cost::text from public.raw_materials where id = $1", [cera]);
    expect(Number(last.rows[0].last_cost)).toBeCloseTo(0.04, 6);

    // excesso recusado sem efeito
    await expect(receive(owner, o.order_id, [{ order_item_id: iCera.id, quantity: 3.5 }])).rejects.toThrow(/acima do pendente/);
    expect((await stock("raw_material_id", cera)).quantity).toBe(2000);

    // preço real diferente do pedido
    const r2 = await receive(owner, o.order_id, [
      { order_item_id: iCera.id, quantity: 3, unit_price: 50 },
      { order_item_id: iVela.id, quantity: 10 },
    ]);
    expect(r2.status).toBe("received");
    const sc2 = await stock("raw_material_id", cera);
    expect(sc2.quantity).toBe(5000);
    expect(sc2.avgCost).toBeCloseTo((2000 * 0.04 + 3000 * 0.05) / 5000, 6);
    expect((await stock("product_id", vela)).quantity).toBe(10);
    const movs = await db.query<{ type: string; source_type: string }>(
      "select m.type, m.source_type from public.stock_movements m join public.purchase_receipts r on r.id = m.source_id where r.order_id = $1",
      [o.order_id],
    );
    expect(movs.rows).toHaveLength(3);
    expect(movs.rows.every((m) => m.type === "compra" && m.source_type === "purchase_receipt")).toBe(true);
  });

  it("pedido com recebimento não é editado nem cancelado; estorno devolve e reabre", async () => {
    const s = await supplier();
    const cera = await raw("Cera Est", "g");
    const o = await saveOrder(owner, s, [{ item_type: "raw_material", item_id: cera, quantity: 1000, unit_price: 0.05 }]);
    const [item] = await orderItems(o.order_id);
    const r = await receive(owner, o.order_id, [{ order_item_id: item.id, quantity: 400 }]);
    await expect(saveOrder(owner, s, [{ item_type: "raw_material", item_id: cera, quantity: 5, unit_price: 1 }], o.order_id)).rejects.toThrow(/não pode ser alterado/);
    await expect(setStatus(owner, o.order_id, "canceled")).rejects.toThrow(/não pode ser cancelado/);

    await expect(reverseReceipt(operator, r.receipt_id)).rejects.toThrow(/sem permissão/);
    await reverseReceipt(manager, r.receipt_id);
    expect((await stock("raw_material_id", cera)).quantity).toBe(0);
    expect((await orderItems(o.order_id))[0].received_quantity).toBe("0.000000");
    expect((await orderStatus(o.order_id)).status).toBe("draft");
    await expect(reverseReceipt(owner, r.receipt_id)).rejects.toThrow(/já estornado/);
    // movimentações do recebimento não são estornadas avulsas
    const mov = (await db.query<{ id: string }>("select id from public.stock_movements where source_id = $1 and type = 'compra'", [r.receipt_id])).rows[0].id;
    await expect(asUser(db, owner, (tx) => tx.query("select public.fn_reverse_stock_movement($1, $2, 'x')", [randomUUID(), mov]))).rejects.toThrow(
      /pertence a um documento|já estornada/,
    );
  });

  it("estorno recusado se o material já foi consumido (sem saldo negativo)", async () => {
    const s = await supplier();
    const cera = await raw("Cera Usada", "g");
    const o = await saveOrder(owner, s, [{ item_type: "raw_material", item_id: cera, quantity: 100, unit_price: 1 }]);
    const [item] = await orderItems(o.order_id);
    const r = await receive(owner, o.order_id, [{ order_item_id: item.id, quantity: 100 }]);
    await asUser(db, owner, (tx) => tx.query("select public.fn_register_stock_movement($1, 'raw_material', $2, 'saida', 60)", [randomUUID(), cera]), { commit: true });
    await expect(reverseReceipt(owner, r.receipt_id)).rejects.toThrow(/Saldo insuficiente/);
    expect((await orderStatus(o.order_id)).status).toBe("received");
  });

  it("encerrar saldo pendente; pedido encerrado não recebe mais", async () => {
    const s = await supplier();
    const cera = await raw("Cera Enc", "g");
    const o = await saveOrder(owner, s, [{ item_type: "raw_material", item_id: cera, quantity: 100, unit_price: 1 }]);
    const [item] = await orderItems(o.order_id);
    await expect(setStatus(owner, o.order_id, "closed")).rejects.toThrow(/recebidos em parte/);
    await receive(owner, o.order_id, [{ order_item_id: item.id, quantity: 30 }]);
    await setStatus(owner, o.order_id, "closed");
    await expect(receive(owner, o.order_id, [{ order_item_id: item.id, quantity: 10 }])).rejects.toThrow(/não aceita recebimento/);
  });

  it("mesmo id de operação no recebimento aplica uma vez; item de outro pedido é recusado", async () => {
    const s = await supplier();
    const cera = await raw("Cera Idem", "g");
    const o = await saveOrder(owner, s, [{ item_type: "raw_material", item_id: cera, quantity: 100, unit_price: 1 }]);
    const o2 = await saveOrder(owner, s, [{ item_type: "raw_material", item_id: cera, quantity: 100, unit_price: 1 }]);
    const [item] = await orderItems(o.order_id);
    const opId = randomUUID();
    await receive(owner, o.order_id, [{ order_item_id: item.id, quantity: 10 }], opId);
    const again = await receive(owner, o.order_id, [{ order_item_id: item.id, quantity: 10 }], opId);
    expect(again.duplicate).toBe(true);
    expect((await stock("raw_material_id", cera)).quantity).toBe(10);
    await expect(receive(owner, o2.order_id, [{ order_item_id: item.id, quantity: 1 }])).rejects.toThrow(/não pertence/);
  });

  it("cancelar rascunho; tabelas de compra sem escrita direta", async () => {
    const s = await supplier();
    const cera = await raw("Cera Canc", "g");
    const o = await saveOrder(owner, s, [{ item_type: "raw_material", item_id: cera, quantity: 1, unit_price: 1 }]);
    await setStatus(manager, o.order_id, "canceled");
    expect((await orderStatus(o.order_id)).status).toBe("canceled");
    await expect(asUser(db, owner, (tx) => tx.query("update public.purchase_orders set status = 'received'"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, owner, (tx) => tx.query("update public.purchase_order_items set received_quantity = 1"))).rejects.toThrow(/permission denied/);
    const r = await asUser(db, outsider, (tx) => tx.query("select id from public.purchase_orders"));
    expect(r.rows).toHaveLength(0);
  });
});
