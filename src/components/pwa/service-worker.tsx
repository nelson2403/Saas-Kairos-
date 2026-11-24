"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

let updateRequested = false;

/**
 * Registra /sw.js e avisa quando há nova versão. A atualização só é aplicada
 * quando o usuário confirma, para não recarregar a tela no meio de uma operação.
 * Em desenvolvimento o SW fica desligado (exceto com NEXT_PUBLIC_ENABLE_SW_DEV=true)
 * para não servir assets antigos durante o hot reload.
 */
export function ServiceWorkerManager() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const enabled = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_SW_DEV === "true";
    if (!enabled) return;

    let refreshing = false;
    const onControllerChange = () => {
      // Na primeira instalação o SW assume a página (clients.claim) e também
      // dispara este evento: só recarrega quando o usuário pediu a atualização.
      if (refreshing || !updateRequested) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) setWaiting(installing);
          });
        });
        // Verifica atualizações ao voltar para o app.
        const onVisible = () => document.visibilityState === "visible" && registration.update().catch(() => {});
        document.addEventListener("visibilitychange", onVisible);
      })
      .catch(() => {
        // Falha no registro não impede o uso online do sistema.
      });

    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  if (!waiting) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-3 bottom-[calc(5rem+var(--safe-bottom))] z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3 shadow-lg md:bottom-6"
    >
      <p className="text-sm">Nova versão do Kairós disponível.</p>
      <Button
        size="sm"
        onClick={() => {
          updateRequested = true;
          waiting.postMessage({ type: "SKIP_WAITING" });
        }}
      >
        Atualizar
      </Button>
    </div>
  );
}

/** Usado no logout: limpa caches privados do Service Worker. */
export function clearPrivateCaches() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return;
  navigator.serviceWorker.controller.postMessage({ type: "CLEAR_PRIVATE_CACHES" });
}
