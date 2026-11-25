import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, createUser, type TestDb } from "./harness";

let db: TestDb;
let owner: string;
let admin: string;
let manager: string;
let newbie: string;
let other: string;
let outsider: string;

type Member = { member_id: string; user_id: string; email: string; full_name: string | null; role_key: string; status: string };

const call = (user: string, sql: string, params: unknown[] = []) => asUser(db, user, (tx) => tx.query(sql, params), { commit: true });
const team = (user: string) => asUser(db, user, async (tx) => (await tx.query<Member>("select * from public.fn_team_members()")).rows);
const memberOf = async (userId: string) => (await team(owner)).find((m) => m.user_id === userId)!;

beforeAll(async () => {
  db = await createTestDb();
  owner = await createUser(db, "dev@example.com");
  admin = await createUser(db, "admin@example.com");
  manager = await createUser(db, "gerente@example.com");
  newbie = await createUser(db, "Proprietaria@Example.com");
  other = await createUser(db, "outra@example.com");
  outsider = await createUser(db, "estranho@example.com");
  await asUser(db, owner, (tx) => tx.query("select public.create_company_with_owner('Kairós')"), { commit: true });
  await call(owner, "select public.fn_add_member('admin@example.com', 'admin', 'Ana Admin')");
  await call(owner, "select public.fn_add_member('gerente@example.com', 'manager')");
}, 60_000);

describe("equipe", () => {
  it("proprietário adiciona pessoa pelo e-mail (sem diferenciar maiúsculas) e a lista mostra e-mail e nome", async () => {
    await call(owner, "select public.fn_add_member('proprietaria@example.com', 'viewer', 'Maria')");
    const m = await memberOf(newbie);
    expect(m).toMatchObject({ role_key: "viewer", status: "active", full_name: "Maria", email: "Proprietaria@Example.com" });
    await expect(call(owner, "select public.fn_add_member('proprietaria@example.com', 'viewer')")).rejects.toThrow(/já faz parte/);
    await expect(call(owner, "select public.fn_add_member('ninguem@example.com', 'viewer')")).rejects.toThrow(/não encontrada/);
  });

  it("só proprietário/administrador gerencia; papel de administrador só pelo proprietário", async () => {
    await expect(team(manager)).rejects.toThrow(/Sem permissão/);
    await expect(call(manager, "select public.fn_add_member('outra@example.com', 'viewer')")).rejects.toThrow(/Sem permissão/);
    await expect(call(outsider, "select public.fn_add_member('outra@example.com', 'viewer')")).rejects.toThrow(/Sem permissão/);
    await expect(call(admin, "select public.fn_add_member('outra@example.com', 'admin')")).rejects.toThrow(/Somente o proprietário/);
    await expect(call(admin, "select public.fn_add_member('outra@example.com', 'owner')")).rejects.toThrow(/Papel inválido/);
    await call(admin, "select public.fn_add_member('outra@example.com', 'operator')");
    expect((await memberOf(other)).role_key).toBe("operator");
  });

  it("alterar papel e suspender: nunca a si mesmo, nunca o proprietário; admin não mexe em admin", async () => {
    const mAdmin = await memberOf(admin);
    const mOwner = await memberOf(owner);
    const mOther = await memberOf(other);
    await expect(call(admin, "select public.fn_set_member_role($1, 'viewer')", [mAdmin.member_id])).rejects.toThrow(/próprio acesso/);
    await expect(call(admin, "select public.fn_set_member_status($1, 'suspended')", [mOwner.member_id])).rejects.toThrow(/proprietário/);
    await call(owner, "select public.fn_add_member('estranho@example.com', 'admin')");
    const mSecondAdmin = await memberOf(outsider);
    await expect(call(admin, "select public.fn_set_member_status($1, 'suspended')", [mSecondAdmin.member_id])).rejects.toThrow(/Somente o proprietário/);
    await call(admin, "select public.fn_set_member_role($1, 'manager')", [mOther.member_id]);
    expect((await memberOf(other)).role_key).toBe("manager");
  });

  it("membro suspenso perde o acesso na hora e volta ao ser reativado", async () => {
    const m = await memberOf(other);
    await call(owner, "select public.fn_set_member_status($1, 'suspended')", [m.member_id]);
    const seen = await asUser(db, other, async (tx) => (await tx.query("select id from public.companies")).rows);
    expect(seen).toHaveLength(0);
    await call(owner, "select public.fn_set_member_status($1, 'active')", [m.member_id]);
    const back = await asUser(db, other, async (tx) => (await tx.query("select id from public.companies")).rows);
    expect(back).toHaveLength(1);
  });

  it("redefinir senha: a checagem do servidor segue as mesmas regras", async () => {
    const mOther = await memberOf(other);
    const r = await asUser(db, admin, async (tx) => (await tx.query<{ u: string }>("select public.fn_member_user_for_admin($1) as u", [mOther.member_id])).rows[0].u);
    expect(r).toBe(other);
    await expect(asUser(db, manager, (tx) => tx.query("select public.fn_member_user_for_admin($1)", [mOther.member_id]))).rejects.toThrow(/Sem permissão/);
    const mOwner = await memberOf(owner);
    await expect(asUser(db, admin, (tx) => tx.query("select public.fn_member_user_for_admin($1)", [mOwner.member_id]))).rejects.toThrow(/proprietário/);
  });

  it("membros não podem ser alterados direto pela API", async () => {
    await expect(asUser(db, owner, (tx) => tx.query("update public.company_members set status = 'active'"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, owner, (tx) => tx.query("delete from public.company_members"))).rejects.toThrow(/permission denied/);
  });

  it("transferir a propriedade: só o proprietário, para pessoa ativa; quem transfere vira administrador", async () => {
    const mNew = await memberOf(newbie);
    await expect(call(admin, "select public.fn_transfer_ownership($1)", [mNew.member_id])).rejects.toThrow(/Somente o proprietário/);
    await call(owner, "select public.fn_transfer_ownership($1)", [mNew.member_id]);
    const list = await team(newbie);
    expect(list.find((m) => m.user_id === newbie)!.role_key).toBe("owner");
    expect(list.find((m) => m.user_id === owner)!.role_key).toBe("admin");
    expect(list.filter((m) => m.role_key === "owner")).toHaveLength(1);
    // o antigo proprietário, agora administrador, não altera a nova proprietária
    const mNewOwner = list.find((m) => m.user_id === newbie)!;
    await expect(call(owner, "select public.fn_set_member_status($1, 'suspended')", [mNewOwner.member_id])).rejects.toThrow(/proprietário/);
  });
});
