/**
 * Concorrência real: PostgreSQL 17 embutido (processo de verdade, várias
 * conexões simultâneas). Prova que a função de movimentação não deixa o saldo
 * ficar negativo nem duplica operações quando muitas requisições chegam juntas.
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

const register = (opId: string, productId: string, type: string, qty: number) =>
  asUserConn(owner, (c) =>
    c.query("select public.fn_register_stock_movement($1, 'product', $2, $3, $4) as r", [opId, productId, type, qty]),
  );

async function newProduct(name: string, initial: number) {
  const id = (
    await admin.query<{ id: string }>(
      "insert into public.products (company_id, name, slug, unit_id) values ($1, $2, $3, $4) returning id",
      [companyId, name, randomUUID(), unitUn],
    )
  ).rows[0].id;
  if (initial) await register(randomUUID(), id, "entrada", initial);
  return id;
}

async function state(productId: string) {
  const r = await admin.query<{ qty: string; sum: string; n: number; negatives: number }>(
    `select b.quantity::text as qty,
            (select coalesce(sum(quantity), 0)::text from public.stock_movements where product_id = $1) as sum,
            (select count(*)::int from public.stock_movements where product_id = $1) as n,
            (select count(*)::int from public.stock_movements where product_id = $1 and balance_after < 0) as negatives
       from public.stock_balances b where b.product_id = $1`,
    [productId],
  );
  return { quantity: Number(r.rows[0].qty), sum: Number(r.rows[0].sum), movements: r.rows[0].n, negatives: r.rows[0].negatives };
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

describe("concorrência na movimentação de estoque", () => {
  it("50 saídas simultâneas nunca deixam o saldo negativo", async () => {
    const p = await newProduct("Concorrência", 100);
    // 50 × 3 = 150 solicitados para 100 disponíveis.
    const results = await Promise.allSettled(Array.from({ length: 50 }, () => register(randomUUID(), p, "saida", 3)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

    expect(ok).toBe(33); // floor(100 / 3)
    expect(failed.every((f) => /Saldo insuficiente/.test(String(f.reason)))).toBe(true);
    const s = await state(p);
    expect(s.quantity).toBe(1);
    expect(s.sum).toBe(s.quantity); // saldo = soma das movimentações
    expect(s.movements).toBe(34); // entrada + 33 saídas
    expect(s.negatives).toBe(0);
  });

  it("entradas e saídas simultâneas fecham a conta exatamente", async () => {
    const p = await newProduct("Misto", 50);
    const ops = Array.from({ length: 40 }, (_, i) => register(randomUUID(), p, i % 2 ? "entrada" : "saida", 2));
    const results = await Promise.allSettled(ops);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const s = await state(p);
    expect(s.quantity).toBe(50);
    expect(s.sum).toBe(50);
  });

  it("o mesmo id de operação enviado 20 vezes ao mesmo tempo aplica uma só vez", async () => {
    const p = await newProduct("Reenvio", 0);
    const opId = randomUUID();
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => register(opId, p, "entrada", 5)));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const s = await state(p);
    expect(s.quantity).toBe(5);
    expect(s.movements).toBe(1);
    const ops = await admin.query("select 1 from public.client_operations where client_op_id = $1", [opId]);
    expect(ops.rowCount).toBe(1);
  });

  it("estornos simultâneos da mesma movimentação: só um vence", async () => {
    const p = await newProduct("Estorno duplo", 10);
    const mov = (await register(randomUUID(), p, "saida", 4)).rows[0].r.movement_id as string;
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        asUserConn(owner, (c) => c.query("select public.fn_reverse_stock_movement($1, $2, 'erro')", [randomUUID(), mov])),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await state(p)).quantity).toBe(10);
  });
});
