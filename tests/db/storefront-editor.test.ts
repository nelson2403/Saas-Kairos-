import { beforeAll, describe, expect, it } from "vitest";
import { asRole, asUser, createTestDb, createUser, type TestDb } from "./harness";

let db: TestDb;
let owner: string;
let manager: string;
let outsider: string;
let companyA: string;

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

const saveDraft = (user: string, draft: unknown) =>
  asUser(db, user, (tx) => tx.query("select public.fn_save_storefront_draft($1::jsonb)", [JSON.stringify(draft)]), { commit: true });
const publish = (user: string, note?: string) =>
  asUser(db, user, async (tx) => (await tx.query<{ v: number }>("select public.fn_publish_storefront($1) as v", [note ?? null])).rows[0].v, { commit: true });
const publicTheme = () => asRole(db, "anon", null, async (tx) => (await tx.query<{ t: unknown }>("select public.store_theme() as t")).rows[0].t);

beforeAll(async () => {
  db = await createTestDb();
  owner = await createUser(db, "owner@example.com");
  manager = await createUser(db, "manager@example.com");
  outsider = await createUser(db, "outsider@example.com");
  await db.exec("update private.app_config set single_company = false");
  companyA = await createCompany(owner, "Kairós");
  await createCompany(outsider, "Outra");
  await addMember(companyA, manager, "manager");
}, 60_000);

describe("personalizar loja", () => {
  it("rascunho não aparece na loja até publicar", async () => {
    expect(await publicTheme()).toBeNull();
    await saveDraft(owner, { theme: { primary: "#111111" } });
    expect(await publicTheme()).toBeNull();
    const v1 = await publish(owner, "primeira");
    expect(v1).toBe(1);
    expect(await publicTheme()).toEqual({ theme: { primary: "#111111" } });
    await saveDraft(owner, { theme: { primary: "#222222" } });
    expect(await publicTheme()).toEqual({ theme: { primary: "#111111" } }); // publicado continua o anterior
  });

  it("versões numeradas e imutáveis; restaurar leva ao rascunho sem publicar", async () => {
    const v2 = await publish(owner);
    expect(v2).toBe(2);
    await asUser(db, owner, (tx) => tx.query("select public.fn_restore_storefront_version(1)"), { commit: true });
    const row = await db.query<{ draft: unknown; published: unknown }>("select draft, published from public.storefront where company_id = $1", [companyA]);
    expect(row.rows[0]).toEqual({ draft: { theme: { primary: "#111111" } }, published: { theme: { primary: "#222222" } } });
    await expect(db.query("update public.storefront_versions set note = 'x' where company_id = $1", [companyA])).rejects.toThrow(/imutável/);
    await expect(asUser(db, owner, (tx) => tx.query("select public.fn_restore_storefront_version(99)"))).rejects.toThrow(/não encontrada/);
  });

  it("gerente e outra empresa não editam; API não escreve direto; outra empresa não lê o rascunho", async () => {
    await expect(saveDraft(manager, {})).rejects.toThrow(/Sem permissão/);
    await expect(publish(manager)).rejects.toThrow(/Sem permissão/);
    await expect(asUser(db, owner, (tx) => tx.query("update public.storefront set published = '{}'"))).rejects.toThrow(/permission denied/);
    const r = await asUser(db, outsider, (tx) => tx.query("select draft from public.storefront"));
    expect(r.rows).toHaveLength(0);
    const seen = await asUser(db, manager, (tx) => tx.query("select draft from public.storefront"));
    expect(seen.rows).toHaveLength(1); // a equipe vê o rascunho (prévia)
  });

  it("recusa documento que não é objeto", async () => {
    await expect(saveDraft(owner, [1, 2])).rejects.toThrow(/inválida/);
  });

  it("imagens da loja: só proprietário/admin e só na pasta da empresa", async () => {
    const up = (user: string, name: string) =>
      asUser(db, user, (tx) => tx.query("insert into storage.objects (bucket_id, name) values ('store-assets', $1)", [name]));
    await up(owner, `${companyA}/store/logo.webp`);
    await expect(up(manager, `${companyA}/store/x.webp`)).rejects.toThrow(/row-level security/);
    await expect(up(owner, `${companyA}/products/x.webp`)).rejects.toThrow(/row-level security/);
    await expect(up(outsider, `${companyA}/store/x.webp`)).rejects.toThrow(/row-level security/);
  });
});
