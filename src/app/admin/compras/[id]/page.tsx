import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Pencil } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { requireMembership } from "@/lib/auth/dal";
import { formatCost, formatMoney, formatQuantity } from "@/modules/inventory/domain";
import { PURCHASE_STATUS_LABEL, PURCHASE_STATUS_TONE, RECEIVABLE, formatPurchaseNumber, lineTotal } from "@/modules/purchasing/domain";
import { canManagePurchases, canReceive, getPurchaseOrder } from "@/modules/purchasing/service";
import { ReceiveForm } from "./receive-form";
import { ReverseReceipt, StatusAction } from "./order-actions";

export const metadata: Metadata = { title: "Pedido de compra" };

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const dateOnly = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });

export default function PurchasePage(props: PageProps<"/admin/compras/[id]">) {
  return (
    <Suspense fallback={<SectionSkeleton lines={4} />}>
      <Detail {...props} />
    </Suspense>
  );
}

async function Detail({ params, searchParams }: PageProps<"/admin/compras/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [{ role }, order] = await Promise.all([requireMembership(), getPurchaseOrder(id)]);
  if (!order) notFound();

  const manage = canManagePurchases(role);
  const editable = manage && ["draft", "ordered"].includes(order.status) && order.receipts.length === 0;
  const receivable = canReceive(role) && RECEIVABLE.has(order.status);
  const itemName = (i: (typeof order.items)[number]) => i.product?.name ?? i.raw_material?.name ?? "—";
  const itemsById = new Map(order.items.map((i) => [i.id, i]));
  const who = (uid: string | null) => (uid && order.people[uid] ? ` por ${order.people[uid]}` : "");
  const pendingLines = order.items
    .map((i) => ({ id: i.id, name: itemName(i), unitCode: i.unit.code, pending: Number(i.quantity) - Number(i.received_quantity), unitPrice: Number(i.unit_price) }))
    .filter((l) => l.pending > 0);

  return (
    <>
      <PageHeader title={`${formatPurchaseNumber(order.number)} · ${order.supplier.name}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={PURCHASE_STATUS_TONE[order.status]} className="text-sm">
            {PURCHASE_STATUS_LABEL[order.status]}
          </Badge>
          {editable && (
            <Link href={`/admin/compras/${id}/editar`} className={buttonVariants({ variant: "outline" })}>
              <Pencil aria-hidden /> Editar
            </Link>
          )}
          <Link href="/admin/compras" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft aria-hidden /> Compras
          </Link>
        </div>
      </PageHeader>
      {sp.salvo && (
        <p role="status" className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">
          Pedido salvo. Quando a mercadoria chegar, registre o recebimento abaixo para dar entrada no estoque.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle className="mb-4">Itens</CardTitle>
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th className="text-right">Pedido</Th>
                <Th className="text-right">Recebido</Th>
                <Th className="text-right">Preço</Th>
                <Th className="text-right">Subtotal</Th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((i) => {
                const href = i.product ? `/admin/produtos/${i.product.id}` : `/admin/materias-primas/${i.raw_material?.id}`;
                const received = Number(i.received_quantity);
                return (
                  <tr key={i.id}>
                    <Td>
                      <Link href={href} className="hover:underline">
                        {itemName(i)}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{i.product ? "Produto" : "Matéria-prima"}</span>
                    </Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">{formatQuantity(i.quantity, i.unit.code)}</Td>
                    <Td className={`whitespace-nowrap text-right tabular-nums ${received >= Number(i.quantity) ? "text-success" : ""}`}>
                      {formatQuantity(received, i.unit.code)}
                    </Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">{formatCost(i.unit_price)}</Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">{formatMoney(lineTotal(Number(i.quantity), Number(i.unit_price)))}</Td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <Td colSpan={4} className="text-right font-medium">
                  Total
                </Td>
                <Td className="text-right font-medium tabular-nums">{formatMoney(order.total)}</Td>
              </tr>
            </tfoot>
          </Table>
        </Card>

        <Card>
          <CardTitle className="mb-3">Resumo</CardTitle>
          <dl className="space-y-2 text-sm">
            <Row label="Fornecedor">
              <Link href={`/admin/fornecedores/${order.supplier.id}`} className="hover:underline">
                {order.supplier.name}
              </Link>
            </Row>
            <Row label="Criado">
              {dateTime.format(new Date(order.created_at))}
              {who(order.created_by)}
            </Row>
            {order.ordered_at && <Row label="Enviado">{dateTime.format(new Date(order.ordered_at))}</Row>}
            {order.expected_date && <Row label="Previsão">{dateOnly.format(new Date(`${order.expected_date}T12:00:00`))}</Row>}
            {order.closed_at && (
              <Row label={order.status === "canceled" ? "Cancelado" : "Encerrado"}>
                {dateTime.format(new Date(order.closed_at))}
                {who(order.closed_by)}
                {order.close_reason && <span className="block text-muted-foreground">{order.close_reason}</span>}
              </Row>
            )}
            {order.notes && <Row label="Observações">{order.notes}</Row>}
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">Contas a pagar deste pedido entram com o módulo financeiro (Fase 5).</p>
          {manage && (
            <div className="mt-4 flex flex-col items-start gap-2 border-t border-border pt-4">
              {order.status === "draft" && <StatusAction orderId={order.id} status="ordered" />}
              {order.status === "partial" && <StatusAction orderId={order.id} status="closed" />}
              {["draft", "ordered"].includes(order.status) && order.items.every((i) => Number(i.received_quantity) === 0) && (
                <StatusAction orderId={order.id} status="canceled" />
              )}
            </div>
          )}
        </Card>

        {receivable && pendingLines.length > 0 && (
          <Card className="lg:col-span-3">
            <CardTitle className="mb-4">Registrar recebimento</CardTitle>
            <ReceiveForm key={order.receipts.length} orderId={order.id} lines={pendingLines} />
          </Card>
        )}

        {order.receipts.length > 0 && (
          <Card className="lg:col-span-3">
            <CardTitle className="mb-4">Recebimentos</CardTitle>
            <ul className="divide-y divide-border">
              {order.receipts.map((r) => (
                <li key={r.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{dateTime.format(new Date(r.created_at))}</span>
                    {r.invoice_number && <span className="text-muted-foreground">NF {r.invoice_number}</span>}
                    <span className="text-muted-foreground">{who(r.created_by)}</span>
                    {r.status === "reversed" && <Badge tone="danger">Estornado</Badge>}
                    {r.status === "active" && manage && (
                      <span className="ml-auto">
                        <ReverseReceipt receiptId={r.id} />
                      </span>
                    )}
                  </div>
                  <ul className="mt-1 text-muted-foreground">
                    {r.items.map((ri) => {
                      const item = itemsById.get(ri.order_item_id);
                      return (
                        <li key={ri.order_item_id}>
                          {item ? itemName(item) : "Item"}: {formatQuantity(ri.quantity, item?.unit.code)} × {formatCost(ri.unit_price)} ={" "}
                          {formatMoney(lineTotal(Number(ri.quantity), Number(ri.unit_price)))}
                        </li>
                      );
                    })}
                  </ul>
                  {r.notes && <p className="mt-1 text-muted-foreground">{r.notes}</p>}
                  {r.status === "reversed" && (
                    <p className="mt-1 text-xs text-danger">
                      Estornado {r.reversed_at && dateTime.format(new Date(r.reversed_at))}
                      {who(r.reversed_by)}
                      {r.reverse_reason && ` · ${r.reverse_reason}`}
                    </p>
                  )}
                </li>
              ))}
            </ul>
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
      <dd className="text-right">{children}</dd>
    </div>
  );
}
