import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { LogoutButton } from "@/components/layout/logout-button";
import { requireUser } from "@/lib/auth/dal";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Criar senha", robots: { index: false } };

export default function SetPasswordPage() {
  return (
    <main className="pt-safe flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <Logo withTagline className="mb-10" />
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-sm">
        <Suspense fallback={<div className="h-56 animate-pulse rounded-md bg-muted" />}>
          <Content />
        </Suspense>
      </div>
    </main>
  );
}

async function Content() {
  const user = await requireUser();
  return (
    <>
      <h1 className="font-display text-2xl">{user.mustChangePassword ? "Crie a sua senha" : "Alterar senha"}</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        {user.mustChangePassword
          ? `Bem-vindo(a)! Você entrou com uma senha temporária (${user.email}). Escolha uma senha só sua para continuar.`
          : `Conta ${user.email}.`}
      </p>
      <PasswordForm forced={user.mustChangePassword} />
      <div className="mt-4 flex justify-end">
        <LogoutButton userId={user.id} />
      </div>
    </>
  );
}
