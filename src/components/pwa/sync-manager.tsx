"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import { QUEUE_CHANNEL, summarize } from "@/lib/offline/queue";
import { syncPending, type SyncResponse, type SyncTransport } from "@/lib/offline/sync";

const transport: SyncTransport = async (op) => {
  const res = await fetch("/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: op.id, companyId: op.companyId, operation: op.operation, payload: op.payload }),
    credentials: "same-origin",
  });
  // 401 e 5xx: mantém pendente (lança para o motor contar a tentativa e parar).
  if (!res.ok) throw new Error(res.status === 401 ? "Sessão expirada: entre novamente para sincronizar." : `Servidor indisponível (${res.status})`);
  return (await res.json()) as SyncResponse;
};

/**
 * Envia a fila offline do usuário quando há conexão: ao abrir o painel, quando a
 * rede volta e quando uma operação nova entra na fila. Após aplicar, atualiza a tela.
 */
export function SyncManager({ userId }: { userId: string }) {
  const isOffline = useOffline();
  const router = useRouter();

  useEffect(() => {
    if (typeof indexedDB === "undefined") return;
    let cancelled = false;

    const run = async () => {
      if (isOffline || cancelled) return;
      try {
        const summary = await summarize(userId);
        if (summary.pending === 0) return;
        const report = await syncPending(transport, userId);
        if (!cancelled && report.applied > 0) router.refresh();
      } catch {
        // IndexedDB indisponível ou falha inesperada: tenta na próxima oportunidade.
      }
    };

    void run();
    const interval = window.setInterval(run, 60_000);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(QUEUE_CHANNEL) : null;
    if (channel) channel.onmessage = () => void run();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      channel?.close();
    };
  }, [userId, isOffline, router]);

  return null;
}
