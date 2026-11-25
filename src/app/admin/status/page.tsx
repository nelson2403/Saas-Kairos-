import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { Card, CardTitle, Badge } from "@/components/ui/card";
import { requireMembership } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { APP_VERSION } from "@/lib/env";
import { PendingOperations } from "@/components/pwa/pending-operations";
import { ClientStatus } from "./client-status";

export const metadata: Metadata = { title: "Status do app" };

export default function StatusPage() {
  return (
    <>
      <PageHeader title="Status do app" description={`SAS Kairós · versão ${APP_VERSION}`} />
      <div className="grid gap-4 lg:grid-cols-3">
        <ClientStatus />
        <Card>
          <CardTitle>Servidor</CardTitle>
          <Suspense fallback={<SectionSkeleton lines={1} />}>
            <ServerCheck />
          </Suspense>
        </Card>
        <Suspense>
          <DeviceOperations />
        </Suspense>
      </div>
    </>
  );
}

async function DeviceOperations() {
  const { user } = await requireMembership();
  return <PendingOperations userId={user.id} />;
}

/** Consulta real ao banco (com RLS do usuário) e mede a latência. */
async function pingDatabase(companyId: string) {
  const supabase = await createClient();
  const started = performance.now();
  const { error } = await supabase.from("companies").select("id").eq("id", companyId).single();
  return { error, ms: Math.round(performance.now() - started) };
}

async function ServerCheck() {
  await connection();
  const { companyId, role } = await requireMembership();
  const { error, ms } = await pingDatabase(companyId);

  return (
    <dl className="mt-3 divide-y divide-border text-sm">
      <div className="flex justify-between py-2.5">
        <dt className="text-muted-foreground">Banco de dados</dt>
        <dd>{error ? <Badge tone="danger">Erro</Badge> : <Badge tone="success">Conectado · {ms} ms</Badge>}</dd>
      </div>
      <div className="flex justify-between py-2.5">
        <dt className="text-muted-foreground">Seu papel</dt>
        <dd className="font-medium">{role}</dd>
      </div>
      <div className="flex justify-between py-2.5">
        <dt className="text-muted-foreground">Verificado em</dt>
        <dd className="font-medium">{new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })}</dd>
      </div>
    </dl>
  );
}
