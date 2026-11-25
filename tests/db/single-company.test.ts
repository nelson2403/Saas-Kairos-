import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, type TestDb } from "./harness";

let db: TestDb;
let first: string;
let second: string;

beforeAll(async () => {
  db = await createTestDb();
  first = await createUser(db, "dev@example.com");
  second = await createUser(db, "funcionario@example.com");
}, 60_000);

describe("instalação de empresa única", () => {
  it("antes da configuração o sistema não está inicializado", async () => {
    const res = await asUser(db, first, (tx) => tx.query<{ v: boolean }>("select public.app_is_initialized() as v"));
    expect(res.rows[0].v).toBe(false);
  });

  it("o primeiro usuário cria a empresa e vira proprietário", async () => {
    await asUser(db, first, (tx) => tx.query("select public.create_company_with_owner('Kairós')"), { commit: true });
    const res = await asUser(db, second, (tx) => tx.query<{ v: boolean }>("select public.app_is_initialized() as v"));
    expect(res.rows[0].v).toBe(true);
  });

  it("um segundo usuário não consegue criar outra empresa", async () => {
    await expect(
      asUser(db, second, (tx) => tx.query("select public.create_company_with_owner('Outra')")),
    ).rejects.toThrow(/Empresa já configurada/);
    const count = await db.query<{ n: number }>("select count(*)::int as n from public.companies");
    expect(count.rows[0].n).toBe(1);
  });

  it("usuário sem vínculo não enxerga a empresa existente", async () => {
    const res = await asUser(db, second, (tx) => tx.query("select id from public.companies"));
    expect(res.rows).toHaveLength(0);
  });
});
