import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { asRole, asUser, createTestDb, createUser, type TestDb } from "./harness";

let db: TestDb;
let owner: string;
let companyA: string;
let unitUn: string;

const createCompany = (userId: string, name: string) =>
  asUser(db, userId, async (tx) => (await tx.query<{ id: string }>("select public.create_company_with_owner($1) as id", [name])).rows[0].id, {
    commit: true,
  });

async function setStore(cfg: Record<string, unknown>) {
  await db.query("update public.companies set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{store}', $2::jsonb) where id = $1", [companyA, JSON.stringify(cfg)]);
}

async function product(opts: { price?: number; stock?: number; visible?: boolean; status?: string; cost?: number } = {}) {
  const slug = `vela-${randomUUID().slice(0, 8)}`;
  const id = (
    await db.query<{ id: string }>(
      "insert into public.products (company_id, name, slug, unit_id, sale_price, show_in_store, status, cost_price) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
      [companyA, `Vela ${slug}`, slug, unitUn, opts.price ?? 50, opts.visible ?? true, opts.status ?? "active", opts.cost ?? 12],
    )
  ).rows[0].id;
  if (opts.stock) {
    await asUser(db, owner, (tx) => tx.query("select public.fn_register_stock_movement($1, 'product', $2, 'entrada', $3)", [randomUUID(), id, opts.stock]), {
      commit: true,
    });
  }
  return { id, slug };
}

const anon = <T>(fn: (tx: TestDb) => Promise<T>) => asRole(db, "anon", null, fn);
const server = <T>(fn: (tx: TestDb) => Promise<T>) => asRole(db, "service_role", null, fn, { commit: true });

type CheckoutResult = { order_id: string; number: number; public_token: string; total: string; duplicate?: boolean };

const customer = { name: "Ana Cliente", email: "Ana@Exemplo.com", phone: "(11) 98765-4321" };
const checkout = (items: { product_id: string; quantity: number }[], opts: { key?: string; delivery?: Record<string, unknown>; consents?: Record<string, boolean>; customer?: Record<string, unknown> } = {}) =>
  server(async (tx) =>
    (
      await tx.query<{ r: CheckoutResult }>("select public.fn_store_checkout($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb) as r", [
        opts.key ?? randomUUID(),
        JSON.stringify(opts.customer ?? customer),
        JSON.stringify(items),
        JSON.stringify(opts.delivery ?? { method: "retirada" }),
        JSON.stringify(opts.consents ?? {}),
      ])
    ).rows[0].r,
  );

async function balance(productId: string) {
  const r = await db.query<{ quantity: string; reserved_quantity: string }>("select quantity::text, reserved_quantity::text from public.stock_balances where product_id = $1", [productId]);
  return { quantity: Number(r.rows[0].quantity), reserved: Number(r.rows[0].reserved_quantity) };
}

beforeAll(async () => {
  db = await createTestDb();
  owner = await createUser(db, "owner@example.com");
  const other = await createUser(db, "other@example.com");
  await db.exec("update private.app_config set single_company = false");
  companyA = await createCompany(owner, "Kairós");
  await createCompany(other, "Outra"); // a loja atende só a primeira empresa
  unitUn = (await db.query<{ id: string }>("select id from public.measurement_units where code = 'un' and company_id is null")).rows[0].id;
  await setStore({ enabled: true, pickup_enabled: true, delivery_enabled: true, delivery_fee: 15, reservation_hours: 24 });
}, 60_000);

describe("leitura pública", () => {
  it("catálogo mostra só produtos ativos marcados para a loja, sem custo", async () => {
    const visible = await product({ stock: 5 });
    const hidden = await product({ visible: false, stock: 5 });
    const inactive = await product({ status: "inactive", stock: 5 });
    const rows = await anon((tx) => tx.query<Record<string, unknown>>("select * from public.store_products()"));
    const ids = rows.rows.map((r) => r.id);
    expect(ids).toContain(visible.id);
    expect(ids).not.toContain(hidden.id);
    expect(ids).not.toContain(inactive.id);
    expect(Object.keys(rows.rows[0])).not.toContain("cost_price");
    const detail = await anon((tx) => tx.query<{ p: Record<string, unknown> }>("select public.store_product($1) as p", [visible.slug]));
    expect(detail.rows[0].p).toMatchObject({ id: visible.id, available: 5 });
    expect(JSON.stringify(detail.rows[0].p)).not.toContain("cost");
    const none = await anon((tx) => tx.query<{ p: unknown }>("select public.store_product($1) as p", [hidden.slug]));
    expect(none.rows[0].p).toBeNull();
  });

  it("anônimo não lê tabelas nem chama o checkout ou o limite de tentativas", async () => {
    await expect(anon((tx) => tx.query("select id from public.products"))).resolves.toMatchObject({ rows: [] });
    await expect(anon((tx) => tx.query("select id from public.orders"))).resolves.toMatchObject({ rows: [] });
    await expect(anon((tx) => tx.query("select public.fn_store_checkout('12345678', '{}', '[]', '{}', '{}')"))).rejects.toThrow(/permission denied/);
    await expect(anon((tx) => tx.query("select public.fn_rate_limit('x', 1, 60)"))).rejects.toThrow(/permission denied/);
  });

  it("configuração pública da loja tem valores padrão e o nome da empresa", async () => {
    const r = await anon((tx) => tx.query<{ s: Record<string, unknown> }>("select public.store_settings() as s"));
    expect(r.rows[0].s).toMatchObject({ company_name: "Kairós", enabled: true, delivery_fee: 15, reservation_hours: 24 });
  });
});

describe("checkout", () => {
  it("cria pedido da loja com reserva com prazo, preço do cadastro e cliente com consentimento", async () => {
    const p = await product({ price: 80, stock: 5 });
    const r = await checkout([{ product_id: p.id, quantity: 2 }], { consents: { whatsapp: true } });
    expect(Number(r.total)).toBe(160);
    expect(await balance(p.id)).toEqual({ quantity: 5, reserved: 2 });
    const o = (await db.query("select channel, status, delivery_method, reserved_until > now() + interval '23 hours' as future from public.orders where id = $1", [r.order_id])).rows[0];
    expect(o).toEqual({ channel: "loja", status: "pending", delivery_method: "retirada", future: true });
    const c = (await db.query<{ email: string; phone: string; whatsapp_opt_in: boolean }>(
      "select c.email, c.phone, c.whatsapp_opt_in from public.customers c join public.orders o on o.customer_id = c.id where o.id = $1",
      [r.order_id],
    )).rows[0];
    expect(c).toEqual({ email: "ana@exemplo.com", phone: "11987654321", whatsapp_opt_in: true });
    const consent = await db.query("select source from public.customer_consents where channel = 'whatsapp' and granted order by created_at desc limit 1");
    expect(consent.rows[0]).toEqual({ source: "loja" });
  });

  it("mesmo cliente (e-mail) é reaproveitado e a loja nunca revoga consentimento", async () => {
    const p = await product({ stock: 5 });
    const a = await checkout([{ product_id: p.id, quantity: 1 }], { customer: { ...customer, email: "fiel@ex.com" }, consents: { marketing: true } });
    const b = await checkout([{ product_id: p.id, quantity: 1 }], { customer: { ...customer, email: "FIEL@ex.com" }, consents: { marketing: false } });
    const ids = await db.query<{ customer_id: string }>("select customer_id from public.orders where id in ($1, $2)", [a.order_id, b.order_id]);
    expect(new Set(ids.rows.map((r) => r.customer_id)).size).toBe(1);
    const c = await db.query<{ marketing_opt_in: boolean }>("select marketing_opt_in from public.customers where id = $1", [ids.rows[0].customer_id]);
    expect(c.rows[0].marketing_opt_in).toBe(true);
  });

  it("entrega exige endereço e cobra a taxa; endereço fica no pedido", async () => {
    const p = await product({ price: 50, stock: 5 });
    await expect(checkout([{ product_id: p.id, quantity: 1 }], { delivery: { method: "entrega", street: "Rua A" } })).rejects.toThrow(/incompleto/);
    const r = await checkout([{ product_id: p.id, quantity: 1 }], {
      delivery: { method: "entrega", postal_code: "01310100", street: "Av. Paulista", address_number: "1000", district: "Bela Vista", city: "São Paulo", state: "SP" },
    });
    expect(Number(r.total)).toBe(65);
    const o = await db.query<{ delivery_address: { city: string } }>("select delivery_address from public.orders where id = $1", [r.order_id]);
    expect(o.rows[0].delivery_address.city).toBe("São Paulo");
    const logs = await db.query("select changes from public.audit_logs where entity = 'orders' and entity_id = $1", [r.order_id]);
    expect(JSON.stringify(logs.rows)).not.toContain("Paulista");
  });

  it("recusa produto oculto, sem estoque, loja fechada e dados inválidos", async () => {
    const hidden = await product({ visible: false, stock: 5 });
    await expect(checkout([{ product_id: hidden.id, quantity: 1 }])).rejects.toThrow(/não encontrado/);
    const p = await product({ stock: 1 });
    await expect(checkout([{ product_id: p.id, quantity: 2 }])).rejects.toThrow(/Estoque insuficiente/);
    expect((await balance(p.id)).reserved).toBe(0);
    await expect(checkout([{ product_id: p.id, quantity: 1 }], { customer: { ...customer, email: "x" } })).rejects.toThrow(/E-mail inválido/);
    await expect(checkout([{ product_id: p.id, quantity: 1 }], { customer: { ...customer, phone: "123" } })).rejects.toThrow(/DDD/);
    await setStore({ enabled: false });
    await expect(checkout([{ product_id: p.id, quantity: 1 }])).rejects.toThrow(/não está recebendo/);
    await setStore({ enabled: true, pickup_enabled: false, delivery_enabled: true, delivery_fee: 15, reservation_hours: 24 });
    await expect(checkout([{ product_id: p.id, quantity: 1 }])).rejects.toThrow(/Retirada indisponível/);
    await setStore({ enabled: true, pickup_enabled: true, delivery_enabled: true, delivery_fee: 15, reservation_hours: 24 });
  });

  it("mesma chave de idempotência devolve o mesmo pedido", async () => {
    const p = await product({ stock: 5 });
    const key = randomUUID();
    const a = await checkout([{ product_id: p.id, quantity: 1 }], { key });
    const b = await checkout([{ product_id: p.id, quantity: 1 }], { key });
    expect(b.order_id).toBe(a.order_id);
    expect(b.duplicate).toBe(true);
    expect((await balance(p.id)).reserved).toBe(1);
  });

  it("acompanhamento pelo link secreto mostra o pedido sem dados pessoais", async () => {
    const p = await product({ stock: 5 });
    const r = await checkout([{ product_id: p.id, quantity: 1 }]);
    const view = await anon((tx) => tx.query<{ o: Record<string, unknown> }>("select public.store_order($1) as o", [r.public_token]));
    expect(view.rows[0].o).toMatchObject({ number: r.number, status: "pending" });
    const text = JSON.stringify(view.rows[0].o);
    expect(text).not.toContain("Ana");
    expect(text).not.toContain("exemplo.com");
    const wrong = await anon((tx) => tx.query<{ o: unknown }>("select public.store_order($1) as o", [randomUUID()]));
    expect(wrong.rows[0].o).toBeNull();
  });
});

describe("reservas com prazo", () => {
  it("reserva vencida é cancelada e devolve o estoque; pagas e do balcão não são afetadas", async () => {
    const p = await product({ stock: 10 });
    const expired = await checkout([{ product_id: p.id, quantity: 3 }]);
    const paid = await checkout([{ product_id: p.id, quantity: 2 }]);
    await asUser(db, owner, (tx) => tx.query("select public.fn_register_order_payment($1, $2, 'pix')", [randomUUID(), paid.order_id]), { commit: true });
    const manual = await asUser(
      db,
      owner,
      async (tx) => (await tx.query<{ r: { order_id: string } }>("select public.fn_create_order($1, null, $2::jsonb) as r", [randomUUID(), JSON.stringify([{ product_id: p.id, quantity: 1 }])])).rows[0].r,
      { commit: true },
    );
    await db.query("update public.orders set reserved_until = now() - interval '1 minute' where id in ($1, $2)", [expired.order_id, paid.order_id]);

    const n = await server(async (tx) => (await tx.query<{ n: number }>("select public.fn_expire_reservations() as n")).rows[0].n);
    expect(n).toBe(1);
    const st = await db.query<{ id: string; status: string }>("select id, status from public.orders where id in ($1, $2, $3)", [expired.order_id, paid.order_id, manual.order_id]);
    const byId = Object.fromEntries(st.rows.map((r) => [r.id, r.status]));
    expect(byId[expired.order_id]).toBe("canceled");
    expect(byId[paid.order_id]).toBe("paid");
    expect(byId[manual.order_id]).toBe("pending");
    expect(await balance(p.id)).toEqual({ quantity: 8, reserved: 1 });
    const rec = await db.query<{ status: string }>("select status from public.financial_transactions where source_id = $1", [expired.order_id]);
    expect(rec.rows[0].status).toBe("canceled");
  });

  it("limite de tentativas por janela", async () => {
    const hit = () => server(async (tx) => (await tx.query<{ ok: boolean }>("select public.fn_rate_limit('checkout:teste', 3, 600) as ok")).rows[0].ok);
    expect([await hit(), await hit(), await hit(), await hit()]).toEqual([true, true, true, false]);
  });

  it("anonimizar o cliente apaga o endereço de entrega dos pedidos", async () => {
    const p = await product({ stock: 5 });
    const r = await checkout([{ product_id: p.id, quantity: 1 }], {
      customer: { ...customer, email: "anon@ex.com" },
      delivery: { method: "entrega", postal_code: "01310100", street: "Rua Secreta", address_number: "1", district: "Centro", city: "São Paulo", state: "SP" },
    });
    const cid = (await db.query<{ customer_id: string }>("select customer_id from public.orders where id = $1", [r.order_id])).rows[0].customer_id;
    await asUser(db, owner, (tx) => tx.query("select public.fn_anonymize_customer($1, 'pedido do titular')", [cid]), { commit: true });
    const o = await db.query("select delivery_address from public.orders where id = $1", [r.order_id]);
    expect(o.rows[0]).toEqual({ delivery_address: null });
  });
});
