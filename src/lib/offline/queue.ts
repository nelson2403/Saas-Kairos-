/**
 * Fila local de operações preparadas offline (IndexedDB).
 *
 * O `id` de cada operação é gerado no cliente e enviado ao servidor como chave
 * de idempotência (tabela client_operations). Reenviar a mesma operação nunca
 * a aplica duas vezes. Nada aqui é definitivo: estoque, vendas e pagamentos só
 * são efetivados quando o servidor valida e confirma.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type OperationStatus = "pending" | "syncing" | "synced" | "failed" | "conflict";

export type PendingOperation<P = unknown> = {
  id: string;
  userId: string;
  companyId: string;
  operation: string;
  createdAt: string;
  payload: P;
  status: OperationStatus;
  attempts: number;
  lastError?: string;
  result?: unknown;
  syncedAt?: string;
};

interface KairosDB extends DBSchema {
  pending_operations: {
    key: string;
    value: PendingOperation;
    indexes: { by_status: OperationStatus; by_user: string };
  };
  meta: {
    key: string;
    value: { key: string; value: unknown };
  };
}

const DB_NAME = "kairos";
const DB_VERSION = 1;
export const QUEUE_CHANNEL = "kairos-queue";

let dbPromise: Promise<IDBPDatabase<KairosDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<KairosDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore("pending_operations", { keyPath: "id" });
        store.createIndex("by_status", "status");
        store.createIndex("by_user", "userId");
        db.createObjectStore("meta", { keyPath: "key" });
      },
    });
  }
  return dbPromise;
}

/** Somente para testes. */
export function __resetQueueDbForTests() {
  dbPromise = null;
}

function notify() {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(QUEUE_CHANNEL);
  channel.postMessage({ type: "changed" });
  channel.close();
}

export async function enqueue<P>(input: {
  /** Chave de idempotência; informe a mesma já usada numa tentativa online. */
  id?: string;
  userId: string;
  companyId: string;
  operation: string;
  payload: P;
}): Promise<PendingOperation<P>> {
  const { id, ...rest } = input;
  const op: PendingOperation<P> = {
    id: id ?? crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "pending",
    attempts: 0,
    ...rest,
  };
  const db = await getDb();
  await db.put("pending_operations", op);
  notify();
  return op;
}

export async function listOperations(userId?: string): Promise<PendingOperation[]> {
  const db = await getDb();
  const all = userId
    ? await db.getAllFromIndex("pending_operations", "by_user", userId)
    : await db.getAll("pending_operations");
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function updateOperation(id: string, patch: Partial<PendingOperation>) {
  const db = await getDb();
  const tx = db.transaction("pending_operations", "readwrite");
  const current = await tx.store.get(id);
  if (!current) return;
  await tx.store.put({ ...current, ...patch, id });
  await tx.done;
  notify();
}

export async function removeOperation(id: string) {
  const db = await getDb();
  await db.delete("pending_operations", id);
  notify();
}

export type QueueSummary = Record<OperationStatus, number> & { total: number; lastSyncAt: string | null };

export async function summarize(userId?: string): Promise<QueueSummary> {
  const ops = await listOperations(userId);
  const summary: QueueSummary = { pending: 0, syncing: 0, synced: 0, failed: 0, conflict: 0, total: ops.length, lastSyncAt: null };
  for (const op of ops) summary[op.status] += 1;
  const db = await getDb();
  summary.lastSyncAt = ((await db.get("meta", "lastSyncAt"))?.value as string | undefined) ?? null;
  return summary;
}

export async function setLastSyncAt(iso: string) {
  const db = await getDb();
  await db.put("meta", { key: "lastSyncAt", value: iso });
  notify();
}

/** Logout: remove dados locais do usuário. */
export async function clearUserData(userId: string) {
  const db = await getDb();
  const tx = db.transaction("pending_operations", "readwrite");
  for (const op of await tx.store.index("by_user").getAll(userId)) {
    // Operações ainda não sincronizadas são preservadas para não perder trabalho;
    // ficam vinculadas ao usuário e só sincronizam quando ele entrar de novo.
    if (op.status === "synced") await tx.store.delete(op.id);
  }
  await tx.done;
  notify();
}
