"use client";

import { useEffect, useState } from "react";
import { CONNECTION_LABEL, useConnectionStatus } from "@/hooks/use-connection-status";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { Card, CardTitle } from "@/components/ui/card";

type SwInfo = { state: string; version: string | null };

function useServiceWorkerInfo(): SwInfo {
  const [info, setInfo] = useState<SwInfo>({ state: "verificando…", version: null });
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- detecção única de suporte do navegador
      setInfo({ state: "não suportado por este navegador", version: null });
      return;
    }
    navigator.serviceWorker.getRegistration().then((reg) => {
      const controller = navigator.serviceWorker.controller;
      if (!reg) {
        setInfo({
          state: process.env.NODE_ENV === "production" ? "não registrado" : "desativado em desenvolvimento",
          version: null,
        });
        return;
      }
      if (!controller) {
        setInfo({ state: reg.waiting ? "atualização aguardando" : "registrado (ativo no próximo carregamento)", version: null });
        return;
      }
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => setInfo({ state: reg.waiting ? "ativo · atualização aguardando" : "ativo", version: e.data?.version ?? null });
      controller.postMessage({ type: "GET_VERSION" }, [channel.port2]);
    });
  }, []);
  return info;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

export function ClientStatus() {
  const { state, summary } = useConnectionStatus();
  const sw = useServiceWorkerInfo();

  return (
    <>
      <Card>
        <CardTitle>Conexão e sincronização</CardTitle>
        <dl className="mt-3 divide-y divide-border">
          <Row label="Estado" value={CONNECTION_LABEL[state]} />
          <Row label="Operações pendentes" value={summary?.pending ?? 0} />
          <Row label="Com conflito ou falha" value={(summary?.conflict ?? 0) + (summary?.failed ?? 0)} />
          <Row
            label="Última sincronização"
            value={summary?.lastSyncAt ? new Date(summary.lastSyncAt).toLocaleString("pt-BR") : "nenhuma ainda"}
          />
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          A fila local está pronta; as primeiras operações que podem ser preparadas offline (movimentações de
          estoque) chegam na Fase 2. Pagamentos e vendas nunca são confirmados offline.
        </p>
      </Card>

      <Card>
        <CardTitle>Aplicativo</CardTitle>
        <dl className="mt-3 divide-y divide-border">
          <Row label="Service Worker" value={sw.state} />
          <Row label="Versão do cache" value={sw.version ?? "—"} />
        </dl>
        <div className="mt-4">
          <InstallPrompt showUnsupported />
        </div>
      </Card>
    </>
  );
}
