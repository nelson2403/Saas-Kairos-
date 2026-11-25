import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { requireMembership } from "@/lib/auth/dal";
import { getCompany } from "@/modules/company/service";
import { canManageCatalog, getStockSettings, listUnits } from "@/modules/inventory/service";
import { CompanyForm } from "./company-form";
import { StockSettingsForm, UnitsManager } from "./stock-settings";

export const metadata: Metadata = { title: "Configurações" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Configurações" description="Empresa, estoque e preferências." />
      <div className="space-y-4">
        <Card>
          <CardTitle>Empresa</CardTitle>
          <CardDescription className="mb-5 mt-1">Dados usados em documentos, loja e mensagens.</CardDescription>
          <Suspense fallback={<SectionSkeleton lines={2} />}>
            <CompanySection />
          </Suspense>
        </Card>
        <Card>
          <CardTitle>Estoque</CardTitle>
          <CardDescription className="mb-5 mt-1">Regras aplicadas pelo banco em toda movimentação.</CardDescription>
          <Suspense fallback={<SectionSkeleton lines={1} />}>
            <StockSection />
          </Suspense>
        </Card>
        <Card>
          <CardTitle>Unidades de medida</CardTitle>
          <CardDescription className="mb-5 mt-1">
            Conversões automáticas entre unidades do mesmo tipo. Massa ↔ volume usa a densidade da matéria-prima.
          </CardDescription>
          <Suspense fallback={<SectionSkeleton lines={2} />}>
            <UnitsSection />
          </Suspense>
        </Card>
        <Card>
          <CardTitle>Demais configurações</CardTitle>
          <CardDescription className="mt-1">
            Equipe e permissões, pagamentos, entrega e retirada (Fases 5–6), loja (Fase 7), Asaas (Fase 8), WhatsApp
            (Fase 9), notificações e segurança (Fase 10) serão adicionados aqui nas respectivas fases.
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

async function StockSection() {
  const { allowNegative, canEdit } = await getStockSettings();
  return <StockSettingsForm allowNegative={allowNegative} canEdit={canEdit} />;
}

async function UnitsSection() {
  const [{ role }, units] = await Promise.all([requireMembership(), listUnits()]);
  return <UnitsManager units={units} canEdit={canManageCatalog(role)} />;
}
