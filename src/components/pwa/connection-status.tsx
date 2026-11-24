"use client";

import { Cloud, CloudOff, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { CONNECTION_LABEL, useConnectionStatus, type ConnectionState } from "@/hooks/use-connection-status";
import { cn } from "@/lib/utils/cn";

const ICONS: Record<ConnectionState, typeof Cloud> = {
  online: Cloud,
  offline: CloudOff,
  syncing: RefreshCw,
  synced: CheckCircle2,
  failed: AlertTriangle,
};

const TONES: Record<ConnectionState, string> = {
  online: "bg-muted text-muted-foreground",
  offline: "bg-warning/10 text-warning",
  syncing: "bg-muted text-foreground",
  synced: "bg-success/10 text-success",
  failed: "bg-danger/10 text-danger",
};

export function ConnectionPill({ className }: { className?: string }) {
  const { state, summary } = useConnectionStatus();
  const Icon = ICONS[state];
  const pending = summary?.pending ?? 0;

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", TONES[state], className)}
    >
      <Icon className={cn("size-3.5", state === "syncing" && "animate-spin")} aria-hidden />
      {CONNECTION_LABEL[state]}
      {pending > 0 && <span className="opacity-80">· {pending} pendente{pending > 1 ? "s" : ""}</span>}
    </span>
  );
}

/** Faixa exibida em todo o app enquanto estiver offline. */
export function OfflineBanner() {
  const { isOffline } = useConnectionStatus();
  if (!isOffline) return null;
  return (
    <div role="status" className="pt-safe bg-warning/15 px-4 py-2 text-center text-sm text-warning">
      Você está offline. Consultas usam dados já carregados; operações ficam pendentes até a conexão voltar.
    </div>
  );
}
