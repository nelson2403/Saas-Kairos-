import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { Badge, Card } from "@/components/ui/card";
import { requireMembership } from "@/lib/auth/dal";
import { SCOPE_LABEL } from "@/modules/inventory/domain";
import { canManageCatalog, canMoveStock, getInventoryCount } from "@/modules/inventory/service";
import { CountSheet } from "./count-sheet";

export const metadata: Metadata = { title: "Contagem de inventário" };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export default function CountPage({ params }: PageProps<"/admin/estoque/inventario/[id]">) {
  return (
    <Suspense fallback={<SectionSkeleton lines={4} />}>
      <Detail params={params} />
    </Suspense>
  );
}

async function Detail({ params }: { params: PageProps<"/admin/estoque/inventario/[id]">["params"] }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { role } = await requireMembership();
  const data = await getInventoryCount(id);
  if (!data) notFound();
  const { count, items } = data;
  const status =
    count.status === "open"
      ? { label: "Em contagem", tone: "warning" as const }
      : count.status === "applied"
        ? { label: "Aplicado", tone: "success" as const }
        : { label: "Cancelado", tone: "neutral" as const };

  return (
    <>
      <PageHeader
        title="Contagem de inventário"
        description={`${SCOPE_LABEL[count.scope]} · aberta em ${dateFormat.format(new Date(count.created_at))}${count.notes ? ` · ${count.notes}` : ""}`}
      >
        <Badge tone={status.tone}>{status.label}</Badge>
      </PageHeader>
      <Card>
        <CountSheet
          countId={count.id}
          open={count.status === "open"}
          canCount={canMoveStock(role)}
          canApply={canManageCatalog(role)}
          items={items.map((i) => ({
            id: i.id,
            name: i.product?.name ?? i.raw_material?.name ?? "",
            code: i.product?.sku ?? i.raw_material?.code ?? null,
            kind: i.product_id ? "Produto" : "Matéria-prima",
            unit: (i.product ?? i.raw_material)?.unit.code ?? "",
            expected: Number(i.expected_quantity),
            current: i.current_quantity,
            counted: i.counted_quantity === null ? null : Number(i.counted_quantity),
          }))}
        />
      </Card>
    </>
  );
}
