"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QUEUE_CHANNEL, listOperations, removeOperation, updateOperation, type PendingOperation } from "@/lib/offline/queue";
import { MOVEMENT_LABEL } from "@/modules/inventory/domain";

const STATUS = {
  pending: { label: "Pendente", tone: "warning" },
  syncing: { label: "Sincronizando", tone: "neutral" },
  conflict: { label: "Conflito", tone: "danger" },
  failed: { label: "Falha", tone: "danger" },
  synced: { label: "Sincronizada", tone: "success" },
} as const;

function describe(op: PendingOperation) {
  if (op.operation === "stock.movement") {
    const p = op.payload as Record<string, string>;
    return `${MOVEMENT_LABEL[p.type] ?? p.type} · ${p.itemName} · ${p.quantity} ${p.unitCode}`;
  }
  return op.operation;
}

/**
 * Operações guardadas neste aparelho. Conflitos e falhas não são reenviados
 * automaticamente: o usuário decide tentar de novo ou descartar.
 */
export function PendingOperations({ userId }: { userId: string }) {
  const [ops, setOps] = useState<PendingOperation[] | null>(null);

  const load = useCallback(async () => {
    if (typeof indexedDB === "undefined") return setOps([]);
    try {
      setOps((await listOperations(userId)).filter((o) => o.status !== "synced").reverse());
    } catch {
      setOps([]);
    }
  }, [userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- leitura inicial do IndexedDB
    void load();
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(QUEUE_CHANNEL);
    channel.onmessage = () => void load();
    return () => channel.close();
  }, [load]);

  return (
    <Card className="lg:col-span-3">
      <CardTitle>Operações neste aparelho</CardTitle>
      {!ops ? null : ops.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nenhuma operação pendente. Tudo o que foi lançado aqui já está no servidor.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {ops.map((op) => {
            const s = STATUS[op.status];
            return (
              <li key={op.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <Badge tone={s.tone}>{s.label}</Badge>
                <div className="min-w-0 flex-1">
                  <p>{describe(op)}</p>
                  <p className="text-xs text-muted-foreground">
                    Criada em {new Date(op.createdAt).toLocaleString("pt-BR")}
                    {op.lastError && ` · ${op.lastError}`}
                  </p>
                </div>
                {(op.status === "conflict" || op.status === "failed") && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => void updateOperation(op.id, { status: "pending", attempts: 0, lastError: undefined })}>
                      Tentar de novo
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("Descartar esta operação? Ela não será aplicada ao estoque.")) void removeOperation(op.id);
                      }}
                    >
                      Descartar
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
