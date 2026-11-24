import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getCompany } from "@/modules/company/service";
import { CompanyForm } from "./company-form";

export const metadata: Metadata = { title: "Configurações" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Configurações" description="Empresa, identidade e preferências." />
      <div className="space-y-4">
        <Card>
          <CardTitle>Empresa</CardTitle>
          <CardDescription className="mb-5 mt-1">Dados usados em documentos, loja e mensagens.</CardDescription>
          <Suspense fallback={<SectionSkeleton lines={2} />}>
            <CompanySection />
          </Suspense>
        </Card>
        <Card>
          <CardTitle>Demais configurações</CardTitle>
          <CardDescription className="mt-1">
            Unidades e categorias (Fase 2), pagamentos, entrega e retirada (Fases 5–6), loja (Fase 7), Asaas (Fase 8),
            WhatsApp (Fase 9), notificações e segurança (Fase 10) serão adicionados aqui nas respectivas fases.
          </CardDescription>
        </Card>
      </div>
    </>
  );
}

async function CompanySection() {
  const { company, canEdit } = await getCompany();
  return <CompanyForm company={company} canEdit={canEdit} />;
}
