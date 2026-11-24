import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { getMembership, requireUser } from "@/lib/auth/dal";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Criar empresa", robots: { index: false } };

export default function OnboardingPage() {
  return (
    <main className="pt-safe flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <Logo withTagline className="mb-10" />
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-sm">
        <h1 className="font-display text-2xl">Bem-vindo ao Kairós</h1>
        <p className="mb-6 mt-1 text-sm text-muted-foreground">
          Cadastre a empresa. Você será o proprietário e poderá convidar a equipe depois.
        </p>
        <Suspense fallback={<div className="h-40 animate-pulse rounded-md bg-muted" />}>
          <Gate />
        </Suspense>
      </div>
    </main>
  );
}

async function Gate() {
  await requireUser();
  if (await getMembership()) redirect("/admin");
  return <OnboardingForm />;
}
