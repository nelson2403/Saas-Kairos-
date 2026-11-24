import { beforeAll, describe, expect, it } from "vitest";
import { asRole, asUser, createTestDb, createUser, type TestDb } from "./harness";

let db: TestDb;
let alice: string; // proprietária da empresa A
let bob: string; // proprietário da empresa B
let carol: string; // operadora da empresa A
let companyA: string;
let companyB: string;

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, "alice@example.com", "Alice");
  bob = await createUser(db, "bob@example.com", "Bob");
  carol = await createUser(db, "carol@example.com", "Carol");

  companyA = await asUser(
    db,
    alice,
    async (tx) =>
      (await tx.query<{ id: string }>("select public.create_company_with_owner('Kairós A', '12.345.678/0001-90') as id"))
        .rows[0].id,
    { commit: true },
  );
  companyB = await asUser(
    db,
    bob,
    async (tx) =>
      (await tx.query<{ id: string }>("select public.create_company_with_owner('Empresa B') as id")).rows[0].id,
    { commit: true },
  );

  // Carol entra na empresa A como operadora (feito pelo servidor/admin).
  await db.query(
    `insert into public.company_members (company_id, user_id, role_id)
     select $1, $2, id from public.roles where company_id is null and key = 'operator'`,
    [companyA, carol],
  );
}, 60_000);

describe("perfis", () => {
  it("cria perfil automaticamente ao cadastrar usuário", async () => {
    const res = await db.query<{ full_name: string }>("select full_name from public.profiles where id = $1", [alice]);
    expect(res.rows[0].full_name).toBe("Alice");
  });
});

describe("onboarding da empresa", () => {
  it("normaliza o documento e torna o criador proprietário", async () => {
    const company = await db.query<{ document: string }>("select document from public.companies where id = $1", [
      companyA,
    ]);
    expect(company.rows[0].document).toBe("12345678000190");

    const member = await db.query<{ key: string }>(
      `select r.key from public.company_members m join public.roles r on r.id = m.role_id
       where m.company_id = $1 and m.user_id = $2`,
      [companyA, alice],
    );
    expect(member.rows[0].key).toBe("owner");
  });

  it("impede que o mesmo usuário crie uma segunda empresa", async () => {
    await expect(
      asUser(db, alice, (tx) => tx.query("select public.create_company_with_owner('Outra')")),
    ).rejects.toThrow(/já vinculado/);
  });

  it("anônimo não pode criar empresa", async () => {
    await expect(
      asRole(db, "anon", null, (tx) => tx.query("select public.create_company_with_owner('Anon')")),
    ).rejects.toThrow(/permission denied/);
  });

  it("registra auditoria da criação", async () => {
    const res = await db.query<{ action: string; actor_id: string }>(
      "select action, actor_id from public.audit_logs where entity = 'companies' and entity_id = $1",
      [companyA],
    );
    expect(res.rows).toEqual([{ action: "insert", actor_id: alice }]);
  });
});

describe("isolamento multi-tenant (RLS)", () => {
  it("cada usuário enxerga apenas a própria empresa", async () => {
    const seenByAlice = await asUser(db, alice, (tx) => tx.query<{ id: string }>("select id from public.companies"));
    expect(seenByAlice.rows.map((r) => r.id)).toEqual([companyA]);

    const seenByBob = await asUser(db, bob, (tx) => tx.query<{ id: string }>("select id from public.companies"));
    expect(seenByBob.rows.map((r) => r.id)).toEqual([companyB]);
  });

  it("anônimo não enxerga empresas, membros nem perfis", async () => {
    const counts = await asRole(db, "anon", null, async (tx) => ({
      companies: (await tx.query("select 1 from public.companies")).rows.length,
      members: (await tx.query("select 1 from public.company_members")).rows.length,
      profiles: (await tx.query("select 1 from public.profiles")).rows.length,
    }));
    expect(counts).toEqual({ companies: 0, members: 0, profiles: 0 });
  });

  it("usuário não altera empresa alheia", async () => {
    const res = await asUser(db, bob, (tx) =>
      tx.query("update public.companies set name = 'Invadida' where id = $1", [companyA]),
    );
    expect(res.affectedRows).toBe(0);
  });

  it("operador não altera dados da empresa; proprietário altera", async () => {
    const byCarol = await asUser(db, carol, (tx) =>
      tx.query("update public.companies set name = 'Nome da Carol' where id = $1", [companyA]),
    );
    expect(byCarol.affectedRows).toBe(0);

    const byAlice = await asUser(db, alice, (tx) =>
      tx.query("update public.companies set name = 'Kairós' where id = $1", [companyA]),
    );
    expect(byAlice.affectedRows).toBe(1);
  });

  it("colegas veem perfis uns dos outros; outras empresas não", async () => {
    const byCarol = await asUser(db, carol, (tx) => tx.query<{ id: string }>("select id from public.profiles"));
    expect(byCarol.rows.map((r) => r.id).sort()).toEqual([alice, carol].sort());

    const byBob = await asUser(db, bob, (tx) => tx.query<{ id: string }>("select id from public.profiles"));
    expect(byBob.rows.map((r) => r.id)).toEqual([bob]);
  });

  it("usuário não se adiciona a outra empresa", async () => {
    await expect(
      asUser(db, bob, (tx) =>
        tx.query(
          `insert into public.company_members (company_id, user_id, role_id)
           select $1, $2, id from public.roles where key = 'owner' and company_id is null`,
          [companyA, bob],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("auditoria visível só para proprietário/administrador", async () => {
    const byCarol = await asUser(db, carol, (tx) => tx.query("select 1 from public.audit_logs"));
    expect(byCarol.rows.length).toBe(0);
    const byAlice = await asUser(db, alice, (tx) =>
      tx.query<{ company_id: string }>("select distinct company_id from public.audit_logs"),
    );
    expect(byAlice.rows.map((r) => r.company_id)).toEqual([companyA]);
  });
});

describe("integrações", () => {
  it("segredos nunca são legíveis pela API, nem pelo proprietário", async () => {
    const integrationId = (
      await db.query<{ id: string }>(
        "insert into public.integrations (company_id, provider) values ($1, 'asaas') returning id",
        [companyA],
      )
    ).rows[0].id;
    await db.query(
      `insert into public.integration_secrets (integration_id, company_id, name, ciphertext, iv, auth_tag, last4)
       values ($1, $2, 'api_key', 'x', 'y', 'z', '1234')`,
      [integrationId, companyA],
    );

    await expect(
      asUser(db, alice, (tx) => tx.query("select * from public.integration_secrets")),
    ).rejects.toThrow(/permission denied/);

    const visible = await asUser(db, alice, (tx) => tx.query("select provider from public.integrations"));
    expect(visible.rows).toEqual([{ provider: "asaas" }]);

    const byCarol = await asUser(db, carol, (tx) => tx.query("select provider from public.integrations"));
    expect(byCarol.rows).toEqual([]);
  });

  it("evento de webhook duplicado é rejeitado (idempotência)", async () => {
    await db.query(
      "insert into public.webhook_events (company_id, provider, event_id, payload) values ($1, 'asaas', 'evt_1', '{}')",
      [companyA],
    );
    await expect(
      db.query(
        "insert into public.webhook_events (company_id, provider, event_id, payload) values ($1, 'asaas', 'evt_1', '{}')",
        [companyA],
      ),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("fila offline", () => {
  it("mesma operação cliente não é aplicada duas vezes", async () => {
    const op = "0b7f6d0e-8f4b-4a51-9a7e-0f0c7f0a1b2c";
    await db.query(
      "insert into public.client_operations (company_id, user_id, client_op_id, operation, status) values ($1, $2, $3, 'test', 'applied')",
      [companyA, alice, op],
    );
    await expect(
      db.query(
        "insert into public.client_operations (company_id, user_id, client_op_id, operation, status) values ($1, $2, $3, 'test', 'applied')",
        [companyA, alice, op],
      ),
    ).rejects.toThrow(/duplicate key/);
  });
});
