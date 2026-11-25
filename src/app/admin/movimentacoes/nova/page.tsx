import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/dal";
import { STOCK_ROLES, listMovableItems, listUnits } from "@/modules/inventory/service";
import { MovementForm } from "./movement-form";

export const metadata: Metadata = { title: "Registrar movimentação" };

export default function NewMovementPage({ searchParams }: PageProps<"/admin/movimentacoes/nova">) {
  return (
    <>
      <PageHeader
        title="Registrar movimentação"
        description="Entradas, saídas, ajustes, perdas, descartes e devoluções. Compras, produção e vendas geram movimentações automaticamente nas próximas fases."
      />
      <Card className="max-w-3xl">
        <Suspense fallback={<SectionSkeleton lines={4} />}>
          <Form searchParams={searchParams} />
        </Suspense>
      </Card>
    </>
  );
}

async function Form({ searchParams }: { searchParams: PageProps<"/admin/movimentacoes/nova">["searchParams"] }) {
  const [{ user, companyId }, sp] = await Promise.all([requireRole(STOCK_ROLES), searchParams]);
  const [items, units] = await Promise.all([listMovableItems(), listUnits()]);
  return (
    <MovementForm
      items={items}
      units={units}
      userId={user.id}
      companyId={companyId}
      initialItem={typeof sp.item === "string" ? sp.item : null}
    />
  );
}
