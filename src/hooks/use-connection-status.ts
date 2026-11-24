"use client";

import { useCallback, useEffect, useState } from "react";
import { useOffline } from "next/offline";
import { QUEUE_CHANNEL, summarize, type QueueSummary } from "@/lib/offline/queue";

export type ConnectionState = "online" | "offline" | "syncing" | "synced" | "failed";

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  online: "Online",
  offline: "Offline",
  syncing: "Sincronizando",
  synced: "Sincronizado",
  failed: "Falha",
};

export function deriveConnectionState(isOffline: boolean, summary: QueueSummary | null): ConnectionState {
  if (isOffline) return "offline";
  if (!summary) return "online";
  if (summary.syncing > 0) return "syncing";
  if (summary.failed > 0 || summary.conflict > 0) return "failed";
  if (summary.lastSyncAt && summary.pending === 0) return "synced";
  return "online";
}

/** Estado de conexão (useOffline do Next) combinado ao estado da fila offline. */
export function useConnectionStatus(userId?: string) {
  const isOffline = useOffline();
  const [summary, setSummary] = useState<QueueSummary | null>(null);

  const refresh = useCallback(async () => {
    if (typeof indexedDB === "undefined") return;
    try {
      setSummary(await summarize(userId));
    } catch {
      // IndexedDB indisponível (ex.: navegação privada em alguns navegadores)
      setSummary(null);
    }
  }, [userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- leitura inicial do IndexedDB
    void refresh();
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(QUEUE_CHANNEL);
    channel.onmessage = () => void refresh();
    return () => channel.close();
  }, [refresh]);

  return { state: deriveConnectionState(isOffline, summary), summary, isOffline, refresh };
}
