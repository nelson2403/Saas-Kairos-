/**
 * Concorrência real na produção (PostgreSQL 17 embutido): ordens disputando os
 * mesmos insumos não deixam saldo negativo, não travam (deadlock) e nunca
 * baixam parcialmente.
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
const unit: Record<string, string> = {};

async function insert(table: string, values: Record<string, unknown>) {
  const cols = Object.keys(values);
  const r = await admin.query<{ id: string }>(
    `insert into public.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    Object.values(values),
  );
  return r.rows[0].id;
}

const product = () => insert("products", { company_id: companyId, name: "Vela", slug: randomUUID(), unit_id: unit.un });

async function material(qty: number) {
  const id = await insert("raw_materials", { company_id: companyId, name: "Insumo", unit_id: unit.g });
  if (qty) {
    await asUserConn(owner, (c) =>
      c.query("select public.fn_register_stock_movement($1, 'raw_material', $2, 'entrada', $3, null, 0.01)", [randomUUID(), id, qty]),
    );
  }
  return id;
}

async function recipe(productId: string, items: { raw_material_id: string; quantity: number }[]) {
  await asUserConn(owner, (c) => c.query("select public.fn_save_recipe($1, 1, 0, $2::jsonb)", [productId, JSON.stringify(items)]));
}

const createOrder = (productId: string, qty: number) =>
  asUserConn(owner, async (c) => (await c.query("select public.fn_create_production_order($1, $2, $3) as r", [randomUUID(), productId, qty])).rows[0].r.order_id as string);

const complete = (orderId: string, produced: number, opId = randomUUID()) =>
  asUserConn(owner, (c) => c.query("select public.fn_complete_production_order($1, $2, $3) as r", [opId, orderId, produced]));

async function balance(column: "raw_material_id" | "product_id", id: string) {
  const r = await admin.query<{ qty: string; sum: string; negatives: number }>(
    `select coalesce((select quantity from public.stock_balances where ${column} = $1), 0)::text as qty,
            (select coalesce(sum(quantity), 0)::text from public.stock_movements where ${column} = $1) as sum,
            (select count(*)::int from public.stock_movements where ${column} = $1 and balance_after < 0) as negatives`,
    [id],
  );
  return { quantity: Number(r.rows[0].qty), sum: Number(r.rows[0].sum), negatives: r.rows[0].negatives };
}

beforeAll(async () => {
  ({ admin, asUserConn, stop } = await startPg());
  owner = (await admin.query<{ id: string }>("insert into auth.users (email) values ('owner@example.com') returning id")).rows[0].id;
  companyId = await asUserConn(owner, async (c) => (await c.query("select public.create_company_with_owner('Kairós') as id")).rows[0].id);
  const units = await admin.query<{ id: string; code: string }>("select id, code from public.measurement_units where company_id is null");
  for (const u of units.rows) unit[u.code] = u.id;
}, 180_000);

afterAll(async () => {
  await stop?.();
});

describe("concorrência na produção", () => {
  it("10 ordens disputando 2 insumos em ordem inversa: sem deadlock, sem negativo, tudo ou nada", async () => {
    const p = await product();
    const a = await material(550);
    const b = await material(10_000);
    // Itens da ficha em ordem diferente da ordem de travamento: a função ordena por id.
    await recipe(p, [
      { raw_material_id: b, quantity: 100 },
      { raw_material_id: a, quantity: 100 },
    ]);
    const orders = await Promise.all(Array.from({ length: 10 }, () => createOrder(p, 1)));
    const results = await Promise.allSettled(orders.map((o) => complete(o, 1)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

    expect(ok).toBe(5); // 550 / 100
    expect(failed.every((f) => /Saldo insuficiente/.test(String(f.reason)))).toBe(true);
    const sa = await balance("raw_material_id", a);
    const sb = await balance("raw_material_id", b);
    const sp = await balance("product_id", p);
    expect(sa.quantity).toBe(50);
    expect(sb.quantity).toBe(10_000 - 5 * 100); // b só baixou nas ordens concluídas
    expect(sp.quantity).toBe(5);
    for (const s of [sa, sb, sp]) {
      expect(s.sum).toBe(s.quantity);
      expect(s.negatives).toBe(0);
    }
    const done = await admin.query("select 1 from public.production_orders where id = any($1) and status = 'completed'", [orders]);
    expect(done.rowCount).toBe(5);
  });

  it("a mesma ordem concluída 10 vezes ao mesmo tempo (ids diferentes): só uma vez", async () => {
    const p = await product();
    const m = await material(1000);
    await recipe(p, [{ raw_material_id: m, quantity: 10 }]);
    const o = await createOrder(p, 2);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => complete(o, 2)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await balance("raw_material_id", m)).quantity).toBe(980);
    expect((await balance("product_id", p)).quantity).toBe(2);
  });

  it("produção e saídas manuais simultâneas no mesmo insumo fecham a conta", async () => {
    const p = await product();
    const m = await material(1000);
    await recipe(p, [{ raw_material_id: m, quantity: 50 }]);
    const orders = await Promise.all(Array.from({ length: 6 }, () => createOrder(p, 1)));
    const manual = Array.from({ length: 10 }, () =>
      asUserConn(owner, (c) => c.query("select public.fn_register_stock_movement($1, 'raw_material', $2, 'saida', 40)", [randomUUID(), m])),
    );
    const results = await Promise.allSettled([...orders.map((o) => complete(o, 1)), ...manual]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true); // 6×50 + 10×40 = 700 ≤ 1000
    const s = await balance("raw_material_id", m);
    expect(s.quantity).toBe(300);
    expect(s.sum).toBe(300);
  });

  it("estornos simultâneos da mesma ordem: só um vence", async () => {
    const p = await product();
    const m = await material(1000);
    await recipe(p, [{ raw_material_id: m, quantity: 100 }]);
    const o = await createOrder(p, 3);
    await complete(o, 3);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        asUserConn(owner, (c) => c.query("select public.fn_reverse_production_order($1, $2, 'erro')", [randomUUID(), o])),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await balance("raw_material_id", m)).quantity).toBe(1000);
    expect((await balance("product_id", p)).quantity).toBe(0);
  });
});
