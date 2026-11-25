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
let unitUn: string;

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

async function product(price: number, stock: number, cost = 10, status = "active") {
  const id = (
    await db.query<{ id: string }>(
      "insert into public.products (company_id, name, slug, unit_id, sale_price, status) values ($1, $2, $3, $4, $5, $6) returning id",
      [companyA, `Vela ${randomUUID().slice(0, 6)}`, randomUUID(), unitUn, price, status],
    )
  ).rows[0].id;
  if (stock) {
    await asUser(db, owner, (tx) => tx.query("select public.fn_register_stock_movement($1, 'product', $2, 'entrada', $3, null, $4)", [randomUUID(), id, stock, cost]), {
      commit: true,
    });
  }
  return id;
}

type Item = { product_id: string; quantity: number; unit_price?: number };
type OrderResult = { order_id: string; number: number; total: string; status: string; duplicate?: boolean };

const createOrder = (
  user: string,
  items: Item[],
  opts: { discount?: number; shipping?: number; payment?: { method: string; paid_at?: string }; customer?: string | null; opId?: string } = {},
) =>
  asUser(
    db,
    user,
    async (tx) =>
      (
        await tx.query<{ r: OrderResult }>("select public.fn_create_order($1, $2, $3::jsonb, $4, $5, null, null, $6::jsonb) as r", [
          opts.opId ?? randomUUID(),
          opts.customer ?? null,
          JSON.stringify(items),
          opts.discount ?? 0,
          opts.shipping ?? 0,
          opts.payment ? JSON.stringify(opts.payment) : null,
        ])
      ).rows[0].r,
    { commit: true },
  );

const pay = (user: string, orderId: string, method = "pix", opId = randomUUID()) =>
  asUser(db, user, async (tx) => (await tx.query<{ r: OrderResult }>("select public.fn_register_order_payment($1, $2, $3) as r", [opId, orderId, method])).rows[0].r, {
    commit: true,
  });

const cancel = (user: string, orderId: string) => asUser(db, user, (tx) => tx.query("select public.fn_cancel_order($1, 'desistiu')", [orderId]), { commit: true });
const refund = (user: string, orderId: string, opId = randomUUID()) =>
  asUser(db, user, (tx) => tx.query("select public.fn_refund_order($1, $2, 'cliente devolveu')", [opId, orderId]), { commit: true });

async function balance(productId: string) {
  const r = await db.query<{ quantity: string; reserved_quantity: string }>(
    "select quantity::text, reserved_quantity::text from public.stock_balances where product_id = $1",
    [productId],
  );
  return { quantity: Number(r.rows[0].quantity), reserved: Number(r.rows[0].reserved_quantity) };
}

const order = async (id: string) =>
  (await db.query<{ status: string; total: string; subtotal: string; paid_at: Date | null }>("select status, total::text, subtotal::text, paid_at from public.orders where id = $1", [id])).rows[0];

const receivable = async (orderId: string) =>
  (await db.query<{ status: string; amount: string; paid_amount: string | null; payment_method: string | null }>(
    "select status, amount::text, paid_amount::text, payment_method from public.financial_transactions where source_type = 'order' and source_id = $1",
    [orderId],
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
  unitUn = (await db.query<{ id: string }>("select id from public.measurement_units where code = 'un' and company_id is null")).rows[0].id;
}, 60_000);

describe("pedido e reserva", () => {
  it("criar reserva o estoque sem baixar e abre conta a receber", async () => {
    const p = await product(50, 10);
    const o = await createOrder(operator, [{ product_id: p, quantity: 3 }], { discount: 10, shipping: 15 });
    expect(o.status).toBe("pending");
    expect(Number(o.total)).toBe(155); // 150 - 10 + 15
    expect(await balance(p)).toEqual({ quantity: 10, reserved: 3 });
    expect(await receivable(o.order_id)).toMatchObject({ status: "open", amount: "155.00" });
    const hist = await db.query("select status from public.order_status_history where order_id = $1", [o.order_id]);
    expect(hist.rows).toEqual([{ status: "pending" }]);
  });

  it("não reserva além do disponível (considera reservas de outros pedidos)", async () => {
    const p = await product(20, 5);
    await createOrder(operator, [{ product_id: p, quantity: 4 }]);
    await expect(createOrder(operator, [{ product_id: p, quantity: 2 }])).rejects.toThrow(/Estoque insuficiente.*disponível 1/);
    expect((await balance(p)).reserved).toBe(4);
  });

  it("saída manual não consome estoque reservado; ajuste (contagem) pode", async () => {
    const p = await product(20, 5);
    await createOrder(operator, [{ product_id: p, quantity: 4 }]);
    await expect(
      asUser(db, owner, (tx) => tx.query("select public.fn_register_stock_movement($1, 'product', $2, 'saida', 2)", [randomUUID(), p])),
    ).rejects.toThrow(/reservado em pedidos/);
    await asUser(db, owner, (tx) => tx.query("select public.fn_register_stock_movement($1, 'product', $2, 'ajuste', -2, null, null, 'quebrou')", [randomUUID(), p]), {
      commit: true,
    });
    expect((await balance(p)).quantity).toBe(3);
  });

  it("produto inativo não é vendido; leitura não cria pedido; desconto maior que o total é recusado", async () => {
    const inactive = await product(20, 5, 10, "inactive");
    await expect(createOrder(owner, [{ product_id: inactive, quantity: 1 }])).rejects.toThrow(/não está disponível/);
    const p = await product(20, 5);
    await expect(createOrder(viewer, [{ product_id: p, quantity: 1 }])).rejects.toThrow(/Sem permissão/);
    await expect(createOrder(owner, [{ product_id: p, quantity: 1 }], { discount: 30 })).rejects.toThrow(/Desconto maior/);
    expect((await balance(p)).reserved).toBe(0); // nada ficou reservado
  });

  it("cancelar libera a reserva e cancela o recebível", async () => {
    const p = await product(20, 5);
    const o = await createOrder(operator, [{ product_id: p, quantity: 2 }]);
    await cancel(operator, o.order_id);
    expect(await balance(p)).toEqual({ quantity: 5, reserved: 0 });
    expect((await receivable(o.order_id)).status).toBe("canceled");
    await expect(pay(owner, o.order_id)).rejects.toThrow(/não está aguardando pagamento/);
  });
});

describe("pagamento e venda", () => {
  it("pagar efetiva a venda: baixa consumindo a reserva, custo registrado, recebível liquidado", async () => {
    const p = await product(50, 10, 12.5);
    const o = await createOrder(operator, [{ product_id: p, quantity: 2 }]);
    await pay(operator, o.order_id, "dinheiro");
    expect(await balance(p)).toEqual({ quantity: 8, reserved: 0 });
    expect((await order(o.order_id)).status).toBe("paid");
    expect(await receivable(o.order_id)).toMatchObject({ status: "paid", paid_amount: "100.00", payment_method: "dinheiro" });
    const item = await db.query<{ unit_cost: string; movement_id: string }>("select unit_cost::text, movement_id from public.order_items where order_id = $1", [o.order_id]);
    expect(Number(item.rows[0].unit_cost)).toBe(12.5);
    const mov = await db.query<{ type: string; quantity: string }>("select type, quantity::text from public.stock_movements where id = $1", [item.rows[0].movement_id]);
    expect(mov.rows[0]).toEqual({ type: "venda", quantity: "-2.000000" });
    const pays = await db.query("select method, amount::text, status from public.payments where order_id = $1", [o.order_id]);
    expect(pays.rows).toEqual([{ method: "dinheiro", amount: "100.00", status: "confirmed" }]);
  });

  it("venda no balcão (pagamento junto) e pagamento repetido com o mesmo id aplica uma vez", async () => {
    const p = await product(30, 10);
    const o = await createOrder(operator, [{ product_id: p, quantity: 1 }], { payment: { method: "pix" } });
    expect(o.status).toBe("paid");
    expect(await balance(p)).toEqual({ quantity: 9, reserved: 0 });

    const o2 = await createOrder(operator, [{ product_id: p, quantity: 1 }]);
    const opId = randomUUID();
    await pay(operator, o2.order_id, "pix", opId);
    const again = await pay(operator, o2.order_id, "pix", opId);
    expect(again.duplicate).toBe(true);
    await expect(pay(operator, o2.order_id)).rejects.toThrow(/não está aguardando/);
    expect((await balance(p)).quantity).toBe(8);
  });

  it("entregar só depois de pago", async () => {
    const p = await product(30, 10);
    const o = await createOrder(operator, [{ product_id: p, quantity: 1 }]);
    await expect(asUser(db, operator, (tx) => tx.query("select public.fn_mark_order_delivered($1)", [o.order_id]))).rejects.toThrow(/pagos/);
    await pay(operator, o.order_id);
    await asUser(db, operator, (tx) => tx.query("select public.fn_mark_order_delivered($1)", [o.order_id]), { commit: true });
    expect((await order(o.order_id)).status).toBe("delivered");
  });

  it("estorno: só gerente+, devolve estoque, estorna pagamento e lança saída de caixa", async () => {
    const p = await product(40, 10);
    const o = await createOrder(operator, [{ product_id: p, quantity: 3 }], { payment: { method: "cartao_credito" } });
    await expect(refund(operator, o.order_id)).rejects.toThrow(/sem permissão/);
    await refund(manager, o.order_id);
    expect(await balance(p)).toEqual({ quantity: 10, reserved: 0 });
    expect((await order(o.order_id)).status).toBe("refunded");
    const pays = await db.query<{ status: string }>("select status from public.payments where order_id = $1", [o.order_id]);
    expect(pays.rows[0].status).toBe("refunded");
    const out = await db.query<{ type: string; status: string; amount: string }>(
      "select type, status, amount::text from public.financial_transactions where source_type = 'order_refund' and source_id = $1",
      [o.order_id],
    );
    expect(out.rows).toEqual([{ type: "expense", status: "paid", amount: "120.00" }]);
    await expect(refund(owner, o.order_id)).rejects.toThrow(/Somente pedidos pagos/);
    const hist = await db.query<{ status: string }>("select status from public.order_status_history where order_id = $1 order by id", [o.order_id]);
    expect(hist.rows.map((h) => h.status)).toEqual(["pending", "paid", "refunded"]);
  });

  it("visão de vendas: desconto rateado e custo; pedidos estornados ficam de fora", async () => {
    const a = await product(60, 10, 20);
    const b = await product(40, 10, 10);
    const o = await createOrder(owner, [
      { product_id: a, quantity: 1 },
      { product_id: b, quantity: 1 },
    ], { discount: 10, payment: { method: "pix" } });
    const rows = await asUser(db, manager, (tx) =>
      tx.query<{ product_id: string; net: string; cost: string }>("select product_id, net::text, cost::text from public.sales_items where order_id = $1", [o.order_id]),
    );
    const byProduct = Object.fromEntries(rows.rows.map((r) => [r.product_id, r]));
    expect(byProduct[a]).toEqual({ product_id: a, net: "54.00", cost: "20.00" });
    expect(byProduct[b]).toEqual({ product_id: b, net: "36.00", cost: "10.00" });
    await refund(owner, o.order_id);
    const after = await asUser(db, manager, (tx) => tx.query("select 1 from public.sales_items where order_id = $1", [o.order_id]));
    expect(after.rowCount).toBe(0);
  });
});

describe("financeiro", () => {
  const category = async (key: string) => (await db.query<{ id: string }>("select id from public.financial_categories where key = $1", [key])).rows[0].id;
  const save = (user: string, args: unknown[]) =>
    asUser(db, user, async (tx) => (await tx.query<{ id: string }>("select public.fn_save_transaction(null, $1, $2, $3, $4, $5) as id", args)).rows[0].id, { commit: true });

  it("despesa manual: criar, liquidar, desfazer, cancelar; operador não acessa", async () => {
    const rent = await category("rent");
    const id = await save(manager, ["expense", rent, "Aluguel dezembro", 1500, "2026-12-05"]);
    await expect(save(operator, ["expense", rent, "X", 1, "2026-12-05"])).rejects.toThrow(/Sem permissão/);
    const seen = await asUser(db, operator, (tx) => tx.query("select id from public.financial_transactions"));
    expect(seen.rows).toHaveLength(0); // operador não vê valores financeiros

    await asUser(db, manager, (tx) => tx.query("select public.fn_settle_transaction($1, current_date, 1500, 'pix')", [id]), { commit: true });
    await expect(asUser(db, manager, (tx) => tx.query("select public.fn_settle_transaction($1, current_date, 1500, 'pix')", [id]))).rejects.toThrow(/já liquidado/);
    await asUser(db, manager, (tx) => tx.query("select public.fn_set_transaction_status($1, 'open')", [id]), { commit: true });
    await asUser(db, manager, (tx) => tx.query("select public.fn_set_transaction_status($1, 'canceled')", [id]), { commit: true });
    const r = await db.query<{ status: string; paid_at: string | null }>("select status, paid_at from public.financial_transactions where id = $1", [id]);
    expect(r.rows[0]).toEqual({ status: "canceled", paid_at: null });
  });

  it("categoria de receita não serve para despesa; pagamento futuro é recusado", async () => {
    const sales = await category("sales");
    await expect(save(owner, ["expense", sales, "Errado", 10, "2026-12-01"])).rejects.toThrow(/não é de despesa/);
    const rent = await category("rent");
    const id = await save(owner, ["expense", rent, "Aluguel", 10, "2026-12-01"]);
    await expect(asUser(db, owner, (tx) => tx.query("select public.fn_settle_transaction($1, current_date + 5, 10, 'pix')", [id]))).rejects.toThrow(/Data de pagamento inválida/);
  });

  it("recebível de pedido só é liquidado pelo pedido", async () => {
    const p = await product(10, 5);
    const o = await createOrder(owner, [{ product_id: p, quantity: 1 }]);
    const tx = await db.query<{ id: string }>("select id from public.financial_transactions where source_type = 'order' and source_id = $1", [o.order_id]);
    await expect(asUser(db, owner, (t) => t.query("select public.fn_settle_transaction($1, current_date, 10, 'pix')", [tx.rows[0].id]))).rejects.toThrow(/no próprio pedido/);
    await expect(asUser(db, owner, (t) => t.query("update public.financial_transactions set status = 'paid'"))).rejects.toThrow(/permission denied/);
  });

  it("contas a pagar de compra não passam do total do pedido", async () => {
    const supplier = (await db.query<{ id: string }>("insert into public.suppliers (company_id, name) values ($1, 'Fornecedor') returning id", [companyA])).rows[0].id;
    const raw = (await db.query<{ id: string }>("insert into public.raw_materials (company_id, name, unit_id) values ($1, 'Cera', $2) returning id", [companyA, unitUn])).rows[0].id;
    const po = await asUser(
      db,
      owner,
      async (tx) =>
        (await tx.query<{ r: { order_id: string } }>("select public.fn_save_purchase_order($1, null, $2, null, null, $3::jsonb) as r", [
          randomUUID(),
          supplier,
          JSON.stringify([{ item_type: "raw_material", item_id: raw, quantity: 10, unit_price: 30 }]),
        ])).rows[0].r.order_id,
      { commit: true },
    );
    const payable = (amount: number) =>
      asUser(db, manager, (tx) => tx.query("select public.fn_create_purchase_payable($1, $2, '2026-12-10')", [po, amount]), { commit: true });
    await payable(150);
    await payable(150);
    await expect(payable(0.01)).rejects.toThrow(/somariam/);
    const rows = await db.query<{ supplier_id: string; type: string }>("select supplier_id, type from public.financial_transactions where source_id = $1", [po]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((r) => r.supplier_id === supplier && r.type === "expense")).toBe(true);
  });

  it("outra empresa não vê pedidos nem lançamentos", async () => {
    const o = await asUser(db, outsider, (tx) => tx.query("select id from public.orders"));
    const f = await asUser(db, outsider, (tx) => tx.query("select id from public.financial_transactions"));
    expect(o.rows).toHaveLength(0);
    expect(f.rows).toHaveLength(0);
  });
});
