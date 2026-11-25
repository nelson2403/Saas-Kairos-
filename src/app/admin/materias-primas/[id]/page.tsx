import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeftRight } from "lucide-react";
import { MovementTable } from "@/components/inventory/movement-table";
import { StockSummary } from "@/components/inventory/stock-summary";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireMembership } from "@/lib/auth/dal";
import { formatCost } from "@/modules/inventory/domain";
import {
  canManageCatalog,
  canMoveStock,
  getItemBalance,
  getRawMaterial,
  listMovements,
  listUnits,
} from "@/modules/inventory/service";
import { countRecipesUsing } from "@/modules/production/service";
import { RawMaterialForm } from "../raw-material-form";

export const metadata: Metadata = { title: "Matéria-prima" };

export default function RawMaterialPage(props: PageProps<"/admin/materias-primas/[id]">) {
  return (
    <Suspense fallback={<SectionSkeleton lines={4} />}>
      <Detail {...props} />
    </Suspense>
  );
}

async function Detail({ params, searchParams }: PageProps<"/admin/materias-primas/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { role } = await requireMembership();
  const [material, units, balance, movements, inRecipes] = await Promise.all([
    getRawMaterial(id),
    listUnits(),
    getItemBalance("raw_material", id),
    listMovements({ itemType: "raw_material", itemId: id }),
    countRecipesUsing(id),
  ]);
  if (!material) notFound();

  return (
    <>
      <PageHeader title={material.name} description={material.code ?? undefined}>
        {canMoveStock(role) && material.status !== "archived" && (
          <Link href={`/admin/movimentacoes/nova?item=raw_material:${id}`} className={buttonVariants()}>
            <ArrowLeftRight aria-hidden /> Movimentar estoque
          </Link>
        )}
      </PageHeader>
      {sp.criado && (
        <p role="status" className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">
          Matéria-prima cadastrada. Registre o saldo inicial em “Movimentar estoque” (tipo Entrada).
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle className="mb-4">Cadastro</CardTitle>
          <RawMaterialForm material={material} units={units} canEdit={canManageCatalog(role)} unitLocked={movements.total > 0 || inRecipes > 0} />
        </Card>
        <StockSummary
          balance={balance}
          minStock={material.min_stock}
          extra={
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Último custo</dt>
              <dd className="tabular-nums">{material.last_cost ? `${formatCost(material.last_cost)}/${balance?.unit_code}` : "—"}</dd>
            </div>
          }
        />
        <Card className="lg:col-span-3">
          <div className="mb-4 flex items-center justify-between">
            <CardTitle>Movimentações</CardTitle>
            {movements.total > 20 && (
              <Link href={`/admin/movimentacoes?item=raw_material:${id}`} className="text-sm text-muted-foreground hover:text-foreground">
                Ver todas ({movements.total})
              </Link>
            )}
          </div>
          <MovementTable rows={movements.rows.slice(0, 20)} canReverse={canManageCatalog(role)} showItem={false} />
        </Card>
      </div>
    </>
  );
}
