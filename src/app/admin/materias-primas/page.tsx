import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, Table, Td, Th } from "@/components/ui/table";
import { requireMembership } from "@/lib/auth/dal";
import { formatCost, formatQuantity } from "@/modules/inventory/domain";
import { canManageCatalog, getStockOverview, listRawMaterials } from "@/modules/inventory/service";

export const metadata: Metadata = { title: "Matérias-primas" };

const STATUS_LABEL = { active: "Ativa", inactive: "Inativa", archived: "Arquivada" } as const;

export default function RawMaterialsPage({ searchParams }: PageProps<"/admin/materias-primas">) {
  return (
    <>
      <PageHeader title="Matérias-primas" description="Insumos usados na produção.">
        <Suspense>
          <NewButton />
        </Suspense>
      </PageHeader>
      <Card>
        <Suspense fallback={<SectionSkeleton />}>
          <List searchParams={searchParams} />
        </Suspense>
      </Card>
    </>
  );
}

async function NewButton() {
  const { role } = await requireMembership();
  if (!canManageCatalog(role)) return null;
  return (
    <Link href="/admin/materias-primas/nova" className={buttonVariants()}>
      <Plus aria-hidden /> Nova matéria-prima
    </Link>
  );
}

async function List({ searchParams }: { searchParams: PageProps<"/admin/materias-primas">["searchParams"] }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const [materials, stock] = await Promise.all([
    listRawMaterials({ q, status: status || undefined }),
    getStockOverview({ type: "raw_material" }),
  ]);
  const balance = new Map(stock.map((s) => [s.item_id, s]));

  return (
    <>
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]" role="search">
        <Input name="q" defaultValue={q} placeholder="Buscar por nome ou código" aria-label="Buscar matérias-primas" />
        <Select name="status" defaultValue={status} aria-label="Situação">
          <option value="">Ativas e inativas</option>
          <option value="active">Somente ativas</option>
          <option value="inactive">Somente inativas</option>
          <option value="archived">Arquivadas</option>
          <option value="all">Todas</option>
        </Select>
        <button type="submit" className={buttonVariants({ variant: "secondary" })}>
          Filtrar
        </button>
      </form>
      {materials.length === 0 ? (
        <EmptyState title={q || status ? "Nenhuma matéria-prima encontrada." : "Nenhuma matéria-prima cadastrada ainda."} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Matéria-prima</Th>
              <Th className="text-right">Saldo</Th>
              <Th className="text-right">Mínimo</Th>
              <Th className="text-right">Custo médio</Th>
              <Th>Situação</Th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => {
              const b = balance.get(m.id);
              return (
                <tr key={m.id} className="hover:bg-muted/40">
                  <Td>
                    <Link href={`/admin/materias-primas/${m.id}`} className="font-medium hover:underline">
                      {m.name}
                    </Link>
                    {m.code && <span className="block text-xs text-muted-foreground">{m.code}</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">
                    {formatQuantity(b?.quantity ?? 0, m.unit.code)}
                    {b?.below_min && (
                      <Badge tone="warning" className="ml-2">
                        Baixo
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{Number(m.min_stock) > 0 ? formatQuantity(m.min_stock, m.unit.code) : "—"}</Td>
                  <Td className="text-right tabular-nums">
                    {b && Number(b.avg_cost) > 0 ? `${formatCost(b.avg_cost)}/${m.unit.code}` : "—"}
                  </Td>
                  <Td>
                    <Badge tone={m.status === "active" ? "success" : "neutral"}>{STATUS_LABEL[m.status]}</Badge>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
