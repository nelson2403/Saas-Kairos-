import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { requireMembership } from "@/lib/auth/dal";
import { formatMoney, formatQuantity } from "@/modules/inventory/domain";
import { CHANNEL_LABEL, ORDER_STATUS_LABEL, ORDER_STATUS_TONE, PAYMENT_METHOD_LABEL, formatOrderNumber } from "@/modules/sales/domain";
import { canRefund, canSell, getOrder } from "@/modules/sales/service";
import { formatAddress, formatPhone } from "@/modules/partners/domain";
import { DELIVERY_LABEL, whatsappLink } from "@/modules/store/domain";
import { CancelOrder, DeliverOrder, PayOrder, RefundOrder } from "./order-actions";

export const metadata: Metadata = { title: "Pedido" };

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const dateOnly = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });

export default function OrderPage(props: PageProps<"/admin/pedidos/[id]">) {
  return (
    <Suspense fallback={<SectionSkeleton lines={4} />}>
      <Detail {...props} />
    </Suspense>
  );
}

async function Detail({ params, searchParams }: PageProps<"/admin/pedidos/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [{ role }, order] = await Promise.all([requireMembership(), getOrder(id)]);
  if (!order) notFound();
  const sell = canSell(role);
  const who = (uid: string | null) => (uid && order.people[uid] ? ` · ${order.people[uid]}` : "");
  const cost = order.items.reduce((s, i) => s + (i.unit_cost == null ? 0 : Number(i.quantity) * Number(i.unit_cost)), 0);
  const hasCost = order.items.every((i) => i.unit_cost != null);

  return (
    <>
      <PageHeader title={formatOrderNumber(order.number)} description={`${CHANNEL_LABEL[order.channel]} · ${dateTime.format(new Date(order.created_at))}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={ORDER_STATUS_TONE[order.status]} className="text-sm">
            {ORDER_STATUS_LABEL[order.status]}
          </Badge>
          <Link href="/admin/pedidos" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft aria-hidden /> Pedidos
          </Link>
        </div>
      </PageHeader>
      {sp.novo && (
        <p role="status" className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">
          {order.status === "pending" ? "Pedido criado e estoque reservado. Registre o pagamento quando receber." : "Venda registrada e estoque baixado."}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle className="mb-4">Itens</CardTitle>
          <Table>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th className="text-right">Qtd.</Th>
                <Th className="text-right">Preço</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((i) => (
                <tr key={i.id}>
                  <Td>
                    <Link href={`/admin/produtos/${i.product.id}`} className="hover:underline">
                      {i.product.name}
                    </Link>
                    {i.product.sku && <span className="block text-xs text-muted-foreground">SKU {i.product.sku}</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">{formatQuantity(i.quantity, i.product.unit.code)}</Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">{formatMoney(i.unit_price)}</Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">{formatMoney(i.total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <dl className="mt-4 ml-auto max-w-xs space-y-1 text-sm">
            <Row label="Subtotal">{formatMoney(order.subtotal)}</Row>
            {Number(order.discount) > 0 && <Row label="Desconto">− {formatMoney(order.discount)}</Row>}
            {Number(order.shipping) > 0 && <Row label="Frete">{formatMoney(order.shipping)}</Row>}
            <Row label="Total">
              <strong className="text-base">{formatMoney(order.total)}</strong>
            </Row>
            {order.paid_at && hasCost && canRefund(role) && (
              <Row label="Custo dos produtos">
                <span className="text-muted-foreground">{formatMoney(cost)}</span>
              </Row>
            )}
          </dl>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardTitle className="mb-3">Resumo</CardTitle>
            <dl className="space-y-2 text-sm">
              <Row label="Cliente">
                {order.customer ? (
                  <Link href={`/admin/clientes/${order.customer.id}`} className="hover:underline">
                    {order.customer.name}
                  </Link>
                ) : (
                  "Sem cliente"
                )}
              </Row>
              {order.contact?.phone && (
                <Row label="WhatsApp">
                  <a href={whatsappLink(order.contact.phone) ?? "#"} target="_blank" rel="noopener noreferrer" className="underline">
                    {formatPhone(order.contact.phone)}
                  </a>
                </Row>
              )}
              {order.contact?.email && <Row label="E-mail">{order.contact.email}</Row>}
              {order.delivery_method && (
                <Row label={DELIVERY_LABEL[order.delivery_method]}>
                  {order.delivery_address
                    ? formatAddress({
                        street: order.delivery_address.street ?? null,
                        address_number: order.delivery_address.address_number ?? null,
                        complement: order.delivery_address.complement ?? null,
                        district: order.delivery_address.district ?? null,
                        city: order.delivery_address.city ?? null,
                        state: order.delivery_address.state ?? null,
                        postal_code: order.delivery_address.postal_code ?? null,
                      }).map((l) => (
                        <span key={l} className="block">
                          {l}
                        </span>
                      ))
                    : "No local combinado"}
                </Row>
              )}
              {order.reserved_until && order.status === "pending" && <Row label="Reserva até">{dateTime.format(new Date(order.reserved_until))}</Row>}
              {order.due_date && order.status === "pending" && <Row label="Vencimento">{dateOnly.format(new Date(`${order.due_date}T12:00:00`))}</Row>}
              {order.payments.map((p) => (
                <Row key={p.id} label="Pagamento">
                  {PAYMENT_METHOD_LABEL[p.method]} · {formatMoney(p.amount)}
                  <span className="block text-xs text-muted-foreground">
                    {p.status === "refunded" ? `estornado ${p.refunded_at ? dateTime.format(new Date(p.refunded_at)) : ""}` : order.paid_at ? dateTime.format(new Date(order.paid_at)) : ""}
                  </span>
                </Row>
              ))}
              {order.close_reason && <Row label="Motivo">{order.close_reason}</Row>}
              {order.notes && <Row label="Observações">{order.notes}</Row>}
            </dl>
          </Card>

          {sell && order.status === "pending" && (
            <Card>
              <CardTitle className="mb-3">Registrar pagamento</CardTitle>
              <PayOrder orderId={order.id} total={formatMoney(order.total)} />
              <div className="mt-4 border-t border-border pt-4">
                <CancelOrder orderId={order.id} />
              </div>
            </Card>
          )}
          {sell && order.status === "paid" && (
            <Card>
              <DeliverOrder orderId={order.id} />
            </Card>
          )}
          {canRefund(role) && (order.status === "paid" || order.status === "delivered") && (
            <Card>
              <RefundOrder orderId={order.id} />
            </Card>
          )}

          <Card>
            <CardTitle className="mb-3">Histórico</CardTitle>
            <ol className="space-y-2 text-sm">
              {order.history.map((h) => (
                <li key={h.id}>
                  <Badge tone={ORDER_STATUS_TONE[h.status]}>{ORDER_STATUS_LABEL[h.status]}</Badge>
                  <span className="block text-xs text-muted-foreground">
                    {dateTime.format(new Date(h.created_at))}
                    {who(h.changed_by)}
                    {h.note && ` · ${h.note}`}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
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
