import type { Metadata } from "next";
import { CloudOff } from "lucide-react";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = { title: "Sem conexão", robots: { index: false } };

/**
 * Página estática servida pelo Service Worker quando uma navegação falha sem
 * rede. Não depende de dados nem de sessão para poder ficar em cache.
 */
export default function OfflinePage() {
  return (
    <main className="pt-safe flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
      <Logo withTagline />
      <div className="max-w-sm space-y-3">
        <CloudOff className="mx-auto size-8 text-muted-foreground" aria-hidden />
        <h1 className="font-display text-2xl">Sem conexão</h1>
        <p className="text-sm text-muted-foreground">
          Esta tela ainda não estava disponível offline. Telas já abertas continuam acessíveis e operações preparadas
          ficam pendentes até a internet voltar.
        </p>
      </div>
      {/* <a> proposital: precisa de recarga completa (via rede/SW), não de navegação no cliente. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/admin" className="rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground">
        Tentar novamente
      </a>
    </main>
  );
}
