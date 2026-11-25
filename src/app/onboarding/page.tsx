import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { LogoutButton } from "@/components/layout/logout-button";
import { getMembership, requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Configuração inicial", robots: { index: false } };

export default function OnboardingPage() {
  return (
    <main className="pt-safe flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <Logo withTagline className="mb-10" />
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-sm">
        <Suspense fallback={<div className="h-40 animate-pulse rounded-md bg-muted" />}>
          <Gate />
        </Suspense>
      </div>
    </main>
  );
}

async function Gate() {
  const user = await requireUser();
  if (await getMembership()) redirect("/admin");

  // Instalação de empresa única: depois da configuração inicial, novos usuários
  // só entram quando o proprietário/administrador libera o acesso.
  const supabase = await createClient();
  const { data: initialized } = await supabase.rpc("app_is_initialized");

  if (initialized) {
    return (
      <>
        <h1 className="font-display text-2xl">Acesso ainda não liberado</h1>
        <p className="mb-6 mt-2 text-sm text-muted-foreground">
          Sua conta ({user.email}) foi criada, mas ainda não faz parte da equipe Kairós. Peça ao administrador para
          liberar o seu acesso e entre novamente.
        </p>
        <LogoutButton userId={user.id} />
      </>
    );
  }

  return (
    <>
      <h1 className="font-display text-2xl">Configuração inicial</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        Cadastre a empresa. Este passo acontece uma única vez; você se torna o proprietário do sistema.
      </p>
      <OnboardingForm />
    </>
  );
}
