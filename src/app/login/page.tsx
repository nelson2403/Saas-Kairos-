import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { isSupabaseConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar", robots: { index: false } };

export default function LoginPage() {
  const configured = isSupabaseConfigured();

  return (
    <main className="pt-safe flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <Logo withTagline className="mb-12" />
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-sm">
        <h1 className="font-display text-2xl">Entrar no painel</h1>
        <p className="mb-6 mt-1 text-sm text-muted-foreground">Acesso restrito à equipe Kairós.</p>
        {configured ? (
          <Suspense>
            <LoginForm />
          </Suspense>
        ) : (
          <p role="alert" className="rounded-md bg-warning/10 p-3 text-sm text-warning [overflow-wrap:anywhere]">
            Configuração pendente: este ambiente ainda não está conectado ao Supabase
            (NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).
          </p>
        )}
      </div>
    </main>
  );
}
