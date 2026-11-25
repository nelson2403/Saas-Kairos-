/**
 * Checkout da loja sob concorrência (PostgreSQL 17 embutido): nunca reserva
 * além do disponível e a mesma tentativa reenviada vira um único pedido.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPg } from "./pg-server";

let admin: pg.Client;
let asUserConn: Awaited<ReturnType<typeof startPg>>["asUserConn"];
let asServerConn: Awaited<ReturnType<typeof startPg>>["asServerConn"];
let stop: () => Promise<void>;
let owner: string;
let companyId: string;
let unitUn: string;

async function product(stock: number) {
  const id = (
    await admin.query<{ id: string }>(
      "insert into public.products (company_id, name, slug, unit_id, sale_price, show_in_store) values ($1, 'Vela', $2, $3, 40, true) returning id",
      [companyId, randomUUID(), unitUn],
    )
  ).rows[0].id;
  await asUserConn(owner, (c) => c.query("select public.fn_register_stock_movement($1, 'product', $2, 'entrada', $3)", [randomUUID(), id, stock]));
  return id;
}

const checkout = (productId: string, qty: number, key = randomUUID()) =>
  asServerConn((c) =>
    c.query("select public.fn_store_checkout($1, $2::jsonb, $3::jsonb, $4::jsonb, '{}'::jsonb) as r", [
      key,
      JSON.stringify({ name: "Cliente", email: `c${randomUUID().slice(0, 6)}@ex.com`, phone: "11987654321" }),
      JSON.stringify([{ product_id: productId, quantity: qty }]),
      JSON.stringify({ method: "retirada" }),
    ]),
  );

beforeAll(async () => {
  ({ admin, asUserConn, asServerConn, stop } = await startPg());
  owner = (await admin.query<{ id: string }>("insert into auth.users (email) values ('owner@example.com') returning id")).rows[0].id;
  companyId = await asUserConn(owner, async (c) => (await c.query("select public.create_company_with_owner('Kairós') as id")).rows[0].id);
  unitUn = (await admin.query<{ id: string }>("select id from public.measurement_units where code = 'un' and company_id is null")).rows[0].id;
  await admin.query("update public.companies set settings = jsonb_build_object('store', jsonb_build_object('enabled', true)) where id = $1", [companyId]);
}, 180_000);

afterAll(async () => {
  await stop?.();
});

describe("concorrência no checkout da loja", () => {
  it("25 checkouts simultâneos para 5 unidades: só 5 pedidos", async () => {
    const p = await product(5);
    const results = await Promise.allSettled(Array.from({ length: 25 }, () => checkout(p, 1)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    const b = await admin.query<{ reserved: string }>("select reserved_quantity::text as reserved from public.stock_balances where product_id = $1", [p]);
    expect(Number(b.rows[0].reserved)).toBe(5);
    const orders = await admin.query("select 1 from public.order_items where product_id = $1", [p]);
    expect(orders.rowCount).toBe(5);
  });

  it("a mesma tentativa enviada 10 vezes ao mesmo tempo cria um pedido", async () => {
    const p = await product(10);
    const key = randomUUID();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => checkout(p, 2, key)));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const orders = await admin.query("select 1 from public.orders where idempotency_key = $1", [key]);
    expect(orders.rowCount).toBe(1);
    const b = await admin.query<{ reserved: string }>("select reserved_quantity::text as reserved from public.stock_balances where product_id = $1", [p]);
    expect(Number(b.rows[0].reserved)).toBe(2);
  });
});
