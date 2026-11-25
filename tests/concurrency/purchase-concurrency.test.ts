/**
 * Recebimentos simultâneos do mesmo pedido (PostgreSQL 17 embutido): nunca
 * recebe acima do pedido nem duplica entrada de estoque.
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
let unitG: string;

async function setup(quantity: number) {
  const supplier = (await admin.query<{ id: string }>("insert into public.suppliers (company_id, name) values ($1, 'Fornecedor') returning id", [companyId])).rows[0].id;
  const raw = (await admin.query<{ id: string }>("insert into public.raw_materials (company_id, name, unit_id) values ($1, 'Cera', $2) returning id", [companyId, unitG])).rows[0].id;
  const order = await asUserConn(owner, async (c) =>
    (await c.query("select public.fn_save_purchase_order($1, null, $2, null, null, $3::jsonb) as r", [
      randomUUID(),
      supplier,
      JSON.stringify([{ item_type: "raw_material", item_id: raw, quantity, unit_price: 0.05 }]),
    ])).rows[0].r.order_id as string,
  );
  const item = (await admin.query<{ id: string }>("select id from public.purchase_order_items where order_id = $1", [order])).rows[0].id;
  return { raw, order, item };
}

const receive = (order: string, item: string, qty: number, opId = randomUUID()) =>
  asUserConn(owner, (c) =>
    c.query("select public.fn_receive_purchase($1, $2, $3::jsonb) as r", [opId, order, JSON.stringify([{ order_item_id: item, quantity: qty }])]),
  );

const balance = async (raw: string) =>
  Number((await admin.query<{ q: string }>("select coalesce((select quantity from public.stock_balances where raw_material_id = $1), 0)::text as q", [raw])).rows[0].q);

beforeAll(async () => {
  ({ admin, asUserConn, stop } = await startPg());
  owner = (await admin.query<{ id: string }>("insert into auth.users (email) values ('owner@example.com') returning id")).rows[0].id;
  companyId = await asUserConn(owner, async (c) => (await c.query("select public.create_company_with_owner('Kairós') as id")).rows[0].id);
  unitG = (await admin.query<{ id: string }>("select id from public.measurement_units where code = 'g' and company_id is null")).rows[0].id;
}, 180_000);

afterAll(async () => {
  await stop?.();
});

describe("concorrência no recebimento de compras", () => {
  it("20 recebimentos simultâneos de 100 para um pedido de 1000: só 10 entram", async () => {
    const { raw, order, item } = await setup(1000);
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => receive(order, item, 100)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(10);
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(failed.every((f) => /acima do pendente|não aceita recebimento/.test(String(f.reason)))).toBe(true);
    expect(await balance(raw)).toBe(1000);
    const st = await admin.query<{ status: string; received: string }>(
      "select o.status, i.received_quantity::text as received from public.purchase_orders o join public.purchase_order_items i on i.order_id = o.id where o.id = $1",
      [order],
    );
    expect(st.rows[0].status).toBe("received");
    expect(Number(st.rows[0].received)).toBe(1000);
  });

  it("o mesmo recebimento reenviado 10 vezes ao mesmo tempo entra uma vez", async () => {
    const { raw, order, item } = await setup(1000);
    const opId = randomUUID();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => receive(order, item, 300, opId)));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await balance(raw)).toBe(300);
    const receipts = await admin.query("select 1 from public.purchase_receipts where order_id = $1", [order]);
    expect(receipts.rowCount).toBe(1);
  });
});
