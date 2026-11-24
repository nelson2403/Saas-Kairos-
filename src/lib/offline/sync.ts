/**
 * Motor de sincronização da fila offline.
 *
 * O transporte é injetado: em produção ele envia para /api/sync; nos testes é
 * simulado. Respostas do servidor:
 *   applied  → operação aplicada (ou já aplicada antes: idempotente)
 *   conflict → o servidor recusou por estado divergente (ex.: saldo insuficiente);
 *              exige decisão do usuário, nunca é reenviada automaticamente
 *   rejected → inválida (validação/permissão); não é reenviada
 * Erro de rede/servidor indisponível → continua pendente para nova tentativa.
 */
import { listOperations, setLastSyncAt, updateOperation, type PendingOperation } from "./queue";

export type SyncResponse =
  | { status: "applied"; result?: unknown }
  | { status: "conflict"; reason: string; result?: unknown }
  | { status: "rejected"; reason: string };

export type SyncTransport = (op: PendingOperation) => Promise<SyncResponse>;

export const MAX_ATTEMPTS = 5;

let running: Promise<SyncReport> | null = null;

export type SyncReport = { applied: number; conflicts: number; rejected: number; retry: number };

/** Sincroniza as operações pendentes. Chamadas concorrentes reutilizam a mesma execução. */
export function syncPending(transport: SyncTransport, userId: string): Promise<SyncReport> {
  if (!running) {
    running = run(transport, userId).finally(() => {
      running = null;
    });
  }
  return running;
}

async function run(transport: SyncTransport, userId: string): Promise<SyncReport> {
  const report: SyncReport = { applied: 0, conflicts: 0, rejected: 0, retry: 0 };
  const ops = (await listOperations(userId)).filter(
    (op) => op.status === "pending" || (op.status === "syncing" && op.attempts < MAX_ATTEMPTS),
  );

  // Ordem de criação preservada: uma operação pode depender da anterior.
  for (const op of ops) {
    await updateOperation(op.id, { status: "syncing", attempts: op.attempts + 1 });
    try {
      const response = await transport(op);
      if (response.status === "applied") {
        await updateOperation(op.id, { status: "synced", result: response.result, syncedAt: new Date().toISOString(), lastError: undefined });
        report.applied += 1;
      } else if (response.status === "conflict") {
        await updateOperation(op.id, { status: "conflict", lastError: response.reason, result: response.result });
        report.conflicts += 1;
      } else {
        await updateOperation(op.id, { status: "failed", lastError: response.reason });
        report.rejected += 1;
      }
    } catch (error) {
      const attempts = op.attempts + 1;
      await updateOperation(op.id, {
        status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        lastError: error instanceof Error ? error.message : "Falha de comunicação",
      });
      report.retry += 1;
      // Sem rede, as próximas também falhariam: interrompe e tenta depois.
      break;
    }
  }

  await setLastSyncAt(new Date().toISOString());
  return report;
}
