import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { Badge, Card, CardDescription, CardTitle } from "@/components/ui/card";
import { EmptyState, Table, Td, Th } from "@/components/ui/table";
import { requireMembership } from "@/lib/auth/dal";
import { SCOPE_LABEL } from "@/modules/inventory/domain";
import { canManageCatalog, listInventoryCounts } from "@/modules/inventory/service";
import { NewCountForm } from "./new-count-form";

export const metadata: Metadata = { title: "Inventário" };

const STATUS = {
  open: { label: "Em contagem", tone: "warning" },
  applied: { label: "Aplicado", tone: "success" },
  canceled: { label: "Cancelado", tone: "neutral" },
} as const;

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export default function InventoryPage() {
  return (
    <>
      <PageHeader title="Inventário" description="Contagem física do estoque. Ao aplicar, o sistema gera ajustes apenas nas diferenças." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Suspense fallback={<SectionSkeleton lines={1} />}>
          <NewCount />
        </Suspense>
        <Card className="lg:col-span-2">
          <CardTitle className="mb-4">Contagens</CardTitle>
          <Suspense fallback={<SectionSkeleton />}>
            <Counts />
          </Suspense>
        </Card>
      </div>
    </>
  );
}

async function NewCount() {
  const { role } = await requireMembership();
  if (!canManageCatalog(role)) return null;
  return (
    <Card className="h-fit">
      <CardTitle>Nova contagem</CardTitle>
      <CardDescription className="mb-4 mt-1">
        Registra o saldo atual de cada item ativo. A equipe preenche o que foi contado; um gerente aplica.
      </CardDescription>
      <NewCountForm />
    </Card>
  );
}

async function Counts() {
  const counts = await listInventoryCounts();
  if (!counts.length) return <EmptyState title="Nenhuma contagem realizada." />;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Aberta em</Th>
          <Th>Itens</Th>
          <Th>Situação</Th>
          <Th>Observações</Th>
        </tr>
      </thead>
      <tbody>
        {counts.map((c) => (
          <tr key={c.id} className="hover:bg-muted/40">
            <Td>
              <Link href={`/admin/estoque/inventario/${c.id}`} className="font-medium hover:underline">
                {dateFormat.format(new Date(c.created_at))}
              </Link>
            </Td>
            <Td>{SCOPE_LABEL[c.scope]}</Td>
            <Td>
              <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
            </Td>
            <Td className="text-muted-foreground">{c.notes ?? "—"}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
