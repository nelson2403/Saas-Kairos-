import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { MovementTable } from "@/components/inventory/movement-table";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { requireMembership } from "@/lib/auth/dal";
import { formatCost, formatMoney, formatQuantity } from "@/modules/inventory/domain";
import { listMovements } from "@/modules/inventory/service";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, formatOrderNumber } from "@/modules/production/domain";
import { canManageRecipes, canProduce, getOrder } from "@/modules/production/service";
import { CompleteForm } from "./complete-form";
import { CancelOrder, ReverseOrder } from "./order-actions";

export const metadata: Metadata = { title: "Ordem de produção" };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export default function OrderPage(props: PageProps<"/admin/producao/[id]">) {
  return (
    <Suspense fallback={<SectionSkeleton lines={4} />}>
      <Order {...props} />
    </Suspense>
  );
}

async function Order({ params, searchParams }: PageProps<"/admin/producao/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [{ role, user, companyId }, order] = await Promise.all([requireMembership(), getOrder(id)]);
  if (!order) notFound();
  const movements = order.status === "planned" || order.status === "canceled" ? null : await listMovements({ sourceId: id });
  const unit = order.product.unit.code;
  const who = (uid: string | null) => (uid && order.people[uid] ? ` por ${order.people[uid]}` : "");
  const planned = Number(order.planned_quantity);
  const produced = order.produced_quantity == null ? null : Number(order.produced_quantity);

  return (
    <>
      <PageHeader title={`${formatOrderNumber(order.number)} · ${order.product.name}`} description={`Ficha técnica versão ${order.recipe.version}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={ORDER_STATUS_TONE[order.status]} className="text-sm">
            {ORDER_STATUS_LABEL[order.status]}
          </Badge>
          <Link href="/admin/producao" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft aria-hidden /> Produção
          </Link>
        </div>
      </PageHeader>
      {sp.aberta && order.status === "planned" && (
        <p role="status" className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">
          Ordem aberta. Quando a produção terminar, informe o que foi produzido e o consumo real abaixo.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardTitle className="mb-3">Resumo</CardTitle>
          <dl className="space-y-2 text-sm">
            <Row label="Planejado">{formatQuantity(planned, unit)}</Row>
            {produced != null && (
              <Row label="Produzido">
                {formatQuantity(produced, unit)}
                {produced < planned && <span className="block text-xs text-warning">perda de {formatQuantity(planned - produced, unit)}</span>}
              </Row>
            )}
            {order.material_cost != null && <Row label="Custo dos insumos">{formatMoney(order.material_cost)}</Row>}
            {order.unit_cost != null && (
              <Row label={`Custo por ${unit}`}>
                {formatCost(order.unit_cost)}
                {order.cost_complete === false && <span className="block text-xs text-warning">incompleto: insumo sem custo</span>}
              </Row>
            )}
            <Row label="Aberta">
              {dateFormat.format(new Date(order.created_at))}
              {who(order.created_by)}
            </Row>
            {order.completed_at && (
              <Row label="Concluída">
                {dateFormat.format(new Date(order.completed_at))}
                {who(order.completed_by)}
              </Row>
            )}
            {order.closed_at && (
              <Row label={order.status === "reversed" ? "Estornada" : "Cancelada"}>
                {dateFormat.format(new Date(order.closed_at))}
                {who(order.closed_by)}
                {order.close_reason && <span className="block text-muted-foreground">{order.close_reason}</span>}
              </Row>
            )}
            {order.notes && <Row label="Observações">{order.notes}</Row>}
          </dl>
        </Card>

        <Card className="lg:col-span-2">
          {order.status === "planned" && canProduce(role) ? (
            <>
              <CardTitle className="mb-3">Concluir produção</CardTitle>
              <CompleteForm
                orderId={order.id}
                number={order.number}
                productName={order.product.name}
                productUnit={unit}
                planned={planned}
                userId={user.id}
                companyId={companyId}
                items={order.items.map((i) => ({
                  id: i.raw_material_id,
                  name: i.raw_material.name,
                  unitCode: i.raw_material.unit.code,
                  planned: Number(i.planned_quantity),
                  available: order.available[i.raw_material_id] ?? 0,
                  cost: order.currentCost[i.raw_material_id] ?? null,
                }))}
              />
              <div className="mt-4 border-t border-border pt-4">
                <CancelOrder orderId={order.id} />
              </div>
            </>
          ) : (
            <>
              <CardTitle className="mb-3">Matérias-primas</CardTitle>
              <Table>
                <thead>
                  <tr>
                    <Th>Matéria-prima</Th>
                    <Th className="text-right">Planejado</Th>
                    <Th className="text-right">Usado</Th>
                    <Th className="text-right">Custo</Th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((i) => (
                    <tr key={i.raw_material_id}>
                      <Td>
                        <Link href={`/admin/materias-primas/${i.raw_material.id}`} className="hover:underline">
                          {i.raw_material.name}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap text-right tabular-nums">{formatQuantity(i.planned_quantity, i.raw_material.unit.code)}</Td>
                      <Td className="whitespace-nowrap text-right tabular-nums">
                        {i.actual_quantity == null ? "—" : formatQuantity(i.actual_quantity, i.raw_material.unit.code)}
                      </Td>
                      <Td className="whitespace-nowrap text-right tabular-nums">
                        {i.total_cost == null ? (i.actual_quantity == null || Number(i.actual_quantity) === 0 ? "—" : "sem custo") : formatMoney(i.total_cost)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {order.status === "completed" && canManageRecipes(role) && (
                <div className="mt-4 border-t border-border pt-4">
                  <ReverseOrder orderId={order.id} />
                </div>
              )}
            </>
          )}
        </Card>

        {movements && (
          <Card className="lg:col-span-3">
            <CardTitle className="mb-4">Movimentações de estoque</CardTitle>
            <MovementTable rows={movements.rows} canReverse={false} />
          </Card>
        )}
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}
