import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { __resetQueueDbForTests, enqueue, listOperations, summarize } from "@/lib/offline/queue";
import { MAX_ATTEMPTS, syncPending, type SyncTransport } from "@/lib/offline/sync";

const user = "user-1";
const company = "company-1";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  __resetQueueDbForTests();
});

describe("fila offline", () => {
  it("guarda id único, usuário, operação, data, dados, status e tentativas", async () => {
    const op = await enqueue({ userId: user, companyId: company, operation: "stock.adjust", payload: { qty: 2 } });
    expect(op.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(op).toMatchObject({ userId: user, operation: "stock.adjust", status: "pending", attempts: 0, payload: { qty: 2 } });
    expect(Date.parse(op.createdAt)).not.toBeNaN();
  });

  it("sincroniza em ordem e marca como sincronizado", async () => {
    await enqueue({ userId: user, companyId: company, operation: "a", payload: 1 });
    await enqueue({ userId: user, companyId: company, operation: "b", payload: 2 });
    const seen: string[] = [];
    const transport: SyncTransport = async (op) => {
      seen.push(op.operation);
      return { status: "applied" };
    };
    const report = await syncPending(transport, user);
    expect(report.applied).toBe(2);
    expect(seen).toEqual(["a", "b"]);
    const summary = await summarize(user);
    expect(summary.synced).toBe(2);
    expect(summary.lastSyncAt).not.toBeNull();
  });

  it("envia sempre o mesmo id (idempotência) ao tentar de novo após queda de rede", async () => {
    const op = await enqueue({ userId: user, companyId: company, operation: "a", payload: 1 });
    const ids: string[] = [];
    let online = false;
    const transport: SyncTransport = async (o) => {
      ids.push(o.id);
      if (!online) throw new Error("Failed to fetch");
      return { status: "applied" };
    };
    const first = await syncPending(transport, user);
    expect(first.retry).toBe(1);
    expect((await listOperations(user))[0]).toMatchObject({ status: "pending", attempts: 1 });

    online = true;
    await syncPending(transport, user);
    expect(ids).toEqual([op.id, op.id]);
    expect((await listOperations(user))[0].status).toBe("synced");
  });

  it("conflito não é reenviado automaticamente e fica visível", async () => {
    await enqueue({ userId: user, companyId: company, operation: "stock.out", payload: { qty: 99 } });
    let calls = 0;
    const transport: SyncTransport = async () => {
      calls += 1;
      return { status: "conflict", reason: "Saldo insuficiente" };
    };
    await syncPending(transport, user);
    await syncPending(transport, user);
    expect(calls).toBe(1);
    const [op] = await listOperations(user);
    expect(op).toMatchObject({ status: "conflict", lastError: "Saldo insuficiente" });
  });

  it("após o limite de tentativas a operação vai para falha", async () => {
    await enqueue({ userId: user, companyId: company, operation: "a", payload: 1 });
    const transport: SyncTransport = async () => {
      throw new Error("Servidor indisponível");
    };
    for (let i = 0; i < MAX_ATTEMPTS; i++) await syncPending(transport, user);
    const [op] = await listOperations(user);
    expect(op).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
  });

  it("execuções concorrentes não enviam a mesma operação duas vezes", async () => {
    await enqueue({ userId: user, companyId: company, operation: "a", payload: 1 });
    let calls = 0;
    const transport: SyncTransport = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return { status: "applied" };
    };
    await Promise.all([syncPending(transport, user), syncPending(transport, user)]);
    expect(calls).toBe(1);
  });

  it("isola operações por usuário", async () => {
    await enqueue({ userId: user, companyId: company, operation: "a", payload: 1 });
    await enqueue({ userId: "user-2", companyId: company, operation: "b", payload: 1 });
    expect((await listOperations(user)).map((o) => o.operation)).toEqual(["a"]);
  });
});
