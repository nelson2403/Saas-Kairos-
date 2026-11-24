"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Share, PlusSquare, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallPlatform = "installed" | "ios" | "android-prompt" | "unsupported";

function subscribeDisplayMode(cb: () => void) {
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  const ua = navigator.userAgent;
  // iPadOS 13+ se identifica como Mac com toque.
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

export function useInstallState() {
  const standalone = useSyncExternalStore(subscribeDisplayMode, isStandalone, () => false);
  const ios = useSyncExternalStore(() => () => {}, isIos, () => false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // exibimos nosso próprio botão
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const platform: InstallPlatform = standalone ? "installed" : ios ? "ios" : deferred ? "android-prompt" : "unsupported";

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  }

  return { platform, install };
}

/** Cartão de instalação: botão nativo no Android/Chrome e instruções no iPhone/iPad. */
export function InstallPrompt({ showUnsupported = false }: { showUnsupported?: boolean }) {
  const { platform, install } = useInstallState();

  if (platform === "installed") {
    return (
      <p className="flex items-center gap-2 text-sm text-success">
        <CheckCircle2 className="size-4" aria-hidden /> Aplicativo instalado neste dispositivo.
      </p>
    );
  }

  if (platform === "android-prompt") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Instale o Kairós para abrir como aplicativo, em tela cheia.</p>
        <Button onClick={install}>
          <Download aria-hidden /> Instalar aplicativo
        </Button>
      </div>
    );
  }

  if (platform === "ios") {
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium">Instalar no iPhone ou iPad</p>
        <ol className="space-y-1.5 text-muted-foreground">
          <li>1. Abra este endereço no <strong className="text-foreground">Safari</strong>.</li>
          <li className="flex items-center gap-1.5">
            2. Toque em <Share className="size-4" aria-label="Compartilhar" /> <strong className="text-foreground">Compartilhar</strong>.
          </li>
          <li className="flex items-center gap-1.5">
            3. Escolha <PlusSquare className="size-4" aria-hidden /> <strong className="text-foreground">Adicionar à Tela de Início</strong>.
          </li>
        </ol>
      </div>
    );
  }

  if (!showUnsupported) return null;
  return (
    <p className="text-sm text-muted-foreground">
      Este navegador não ofereceu instalação agora. No Android use o Chrome (menu ⋮ → Instalar app); no
      iPhone use o Safari. A instalação exige HTTPS.
    </p>
  );
}
