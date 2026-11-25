import { NextResponse } from "next/server";
import { z } from "zod";
import { getMembership } from "@/lib/auth/dal";
import type { SyncResponse } from "@/lib/offline/sync";
import { canMoveStock, registerMovement } from "@/modules/inventory/service";

/**
 * Recebe uma operação da fila offline. O `id` da operação é a chave de
 * idempotência: reenviar a mesma operação devolve o resultado já aplicado.
 *
 * Respostas (HTTP 200): applied | conflict | rejected.
 * 401: sem sessão (a operação continua pendente até o usuário entrar de novo).
 * 5xx: falha temporária (o cliente tenta de novo).
 */
const bodySchema = z.object({
  id: z.uuid(),
  companyId: z.uuid(),
  operation: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

export async function POST(request: Request) {
  const membership = await getMembership();
  if (!membership) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ status: "rejected", reason: "Operação inválida." });
  const op = parsed.data;

  if (op.companyId !== membership.companyId) {
    return json({ status: "rejected", reason: "Operação pertence a outra empresa." });
  }

  switch (op.operation) {
    case "stock.movement": {
      if (!canMoveStock(membership.role)) return json({ status: "rejected", reason: "Sem permissão para movimentar estoque." });
      const strings = Object.fromEntries(
        Object.entries(op.payload).filter(([, v]) => typeof v === "string") as [string, string][],
      );
      const result = await registerMovement({ ...strings, op_id: op.id });
      if (result.ok) return json({ status: "applied", result: result.data });
      if (result.conflict) return json({ status: "conflict", reason: result.error ?? "Conflito de estoque." });
      const reason = result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? "Operação recusada.";
      return json({ status: "rejected", reason });
    }
    default:
      return json({ status: "rejected", reason: `Operação desconhecida: ${op.operation}` });
  }
}

function json(body: SyncResponse) {
  return NextResponse.json(body);
}
