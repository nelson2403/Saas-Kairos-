/**
 * Pedidos simultâneos (PostgreSQL 17 embutido): reservas nunca passam do
 * disponível, pagamentos não duplicam baixa e saídas manuais não consomem
 * estoque reservado.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPg } from "./pg-server";

let admin: pg.Client;
let asUserConn: Awaited<ReturnType<typeof startPg>>["asUserConn"];
let stop: () => Promise<void>;
let owner: string;
let companyId: string;
let unitUn: string;

async function product(stock: number) {
  const id = (
    await admin.query<{ id: string }>(
      "insert into public.products (company_id, name, slug, unit_id, sale_price) values ($1, 'Vela', $2, $3, 50) returning id",
      [companyId, randomUUID(), unitUn],
    )
  ).rows[0].id;
  await asUserConn(owner, (c) => c.query("select public.fn_register_stock_movement($1, 'product', $2, 'entrada', $3)", [randomUUID(), id, stock]));
  return id;
}

const createOrder = (productId: string, qty: number, payment: unknown = null) =>
  asUserConn(owner, async (c) =>
    (await c.query("select public.fn_create_order($1, null, $2::jsonb, 0, 0, null, null, $3::jsonb) as r", [
      randomUUID(),
      JSON.stringify([{ product_id: productId, quantity: qty }]),
      payment ? JSON.stringify(payment) : null,
    ])).rows[0].r.order_id as string,
  );

async function balance(productId: string) {
  const r = await admin.query<{ q: string; r: string; sum: string }>(
    `select b.quantity::text as q, b.reserved_quantity::text as r,
            (select coalesce(sum(quantity), 0)::text from public.stock_movements where product_id = $1) as sum
       from public.stock_balances b where b.product_id = $1`,
    [productId],
  );
  return { quantity: Number(r.rows[0].q), reserved: Number(r.rows[0].r), sum: Number(r.rows[0].sum) };
}

beforeAll(async () => {
  ({ admin, asUserConn, stop } = await startPg());
  owner = (await admin.query<{ id: string }>("insert into auth.users (email) values ('owner@example.com') returning id")).rows[0].id;
  companyId = await asUserConn(owner, async (c) => (await c.query("select public.create_company_with_owner('Kairós') as id")).rows[0].id);
  unitUn = (await admin.query<{ id: string }>("select id from public.measurement_units where code = 'un' and company_id is null")).rows[0].id;
}, 180_000);

afterAll(async () => {
  await stop?.();
});

describe("concorrência em pedidos", () => {
  it("30 pedidos simultâneos de 1 unidade com 10 em estoque: só 10 reservam", async () => {
    const p = await product(10);
    const results = await Promise.allSettled(Array.from({ length: 30 }, () => createOrder(p, 1)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(await balance(p)).toMatchObject({ quantity: 10, reserved: 10 });
    const orders = await admin.query("select 1 from public.orders o join public.order_items i on i.order_id = o.id where i.product_id = $1", [p]);
    expect(orders.rowCount).toBe(10); // os recusados não deixaram pedido órfão
  });

  it("vendas no balcão e saídas manuais simultâneas: nunca negativo, conta fecha", async () => {
    const p = await product(20);
    const sales = Array.from({ length: 15 }, () => createOrder(p, 1, { method: "pix" }));
    const exits = Array.from({ length: 15 }, () =>
      asUserConn(owner, (c) => c.query("select public.fn_register_stock_movement($1, 'product', $2, 'saida', 1)", [randomUUID(), p])),
    );
    const results = await Promise.allSettled([...sales, ...exits]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(20);
    const b = await balance(p);
    expect(b).toMatchObject({ quantity: 0, reserved: 0 });
    expect(b.sum).toBe(0);
  });

  it("pagamentos simultâneos do mesmo pedido: baixa uma vez", async () => {
    const p = await product(5);
    const order = await createOrder(p, 2);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => asUserConn(owner, (c) => c.query("select public.fn_register_order_payment($1, $2, 'pix')", [randomUUID(), order]))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await balance(p)).toMatchObject({ quantity: 3, reserved: 0 });
    const pays = await admin.query("select 1 from public.payments where order_id = $1", [order]);
    expect(pays.rowCount).toBe(1);
  });
});
