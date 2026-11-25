import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BarChart3, Plus } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { PeriodFilter, StatCard } from "@/components/reports/period-filter";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { EmptyState, Table, Td, Th } from "@/components/ui/table";
import { requireMembership } from "@/lib/auth/dal";
import { parsePeriod } from "@/modules/finance/domain";
import { formatMoney } from "@/modules/inventory/domain";
import { CHANNEL_LABEL, ORDER_STATUS_LABEL, ORDER_STATUS_TONE, formatOrderNumber, todayBR } from "@/modules/sales/domain";
import { canRefund, canSell, listPaidOrders, listSaleItems } from "@/modules/sales/service";

export const metadata: Metadata = { title: "Vendas" };

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export default function SalesPage({ searchParams }: PageProps<"/admin/vendas">) {
  return (
    <>
      <PageHeader title="Vendas" description="Vendas efetivadas: pedidos com pagamento registrado, pela data do pagamento.">
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/relatorios" className={buttonVariants({ variant: "outline" })}>
            <BarChart3 aria-hidden /> Relatórios
          </Link>
          <Suspense>
            <NewButton />
          </Suspense>
        </div>
      </PageHeader>
      <Card>
        <Suspense fallback={<SectionSkeleton />}>
          <Sales searchParams={searchParams} />
        </Suspense>
      </Card>
    </>
  );
}

async function NewButton() {
  const { role } = await requireMembership();
  if (!canSell(role)) return null;
  return (
    <Link href="/admin/pedidos/novo?pago=1" className={buttonVariants()}>
      <Plus aria-hidden /> Nova venda
    </Link>
  );
}

async function Sales({ searchParams }: { searchParams: PageProps<"/admin/vendas">["searchParams"] }) {
  const sp = await searchParams;
  const today = todayBR();
  const { from, to } = parsePeriod(sp.de, sp.ate, today);
  const [{ role }, orders, items] = await Promise.all([requireMembership(), listPaidOrders(from, to), listSaleItems(from, to)]);
  const revenue = orders.reduce((s, o) => s + Number(o.total), 0);
  const cost = items.reduce((s, i) => s + Number(i.cost), 0);
  const net = items.reduce((s, i) => s + Number(i.net), 0);
  const showCost = canRefund(role);
  const missingCost = items.some((i) => i.unit_cost == null || Number(i.unit_cost) === 0);

  return (
    <>
      <PeriodFilter action="/admin/vendas" from={from} to={to} today={today} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Faturamento" value={formatMoney(revenue)} hint="Total pago (com frete, sem desconto)" />
        <StatCard label="Vendas" value={String(orders.length)} />
        <StatCard label="Ticket médio" value={formatMoney(orders.length ? revenue / orders.length : 0)} />
        {showCost && (
          <StatCard
            label="Lucro bruto dos produtos"
            value={formatMoney(net - cost)}
            hint={missingCost ? "Algum produto vendido estava sem custo: valor aproximado" : `Margem ${net > 0 ? Math.round(((net - cost) / net) * 1000) / 10 : 0}%`}
          />
        )}
      </div>
      {orders.length === 0 ? (
        <EmptyState title="Nenhuma venda no período." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Pedido</Th>
              <Th>Pago em</Th>
              <Th>Cliente</Th>
              <Th>Canal</Th>
              <Th className="text-right">Total</Th>
              <Th>Situação</Th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-muted/40">
                <Td>
                  <Link href={`/admin/pedidos/${o.id}`} className="font-medium hover:underline">
                    {formatOrderNumber(o.number)}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap">{o.paid_at && dateTime.format(new Date(o.paid_at))}</Td>
                <Td>{o.customer?.name ?? <span className="text-muted-foreground">—</span>}</Td>
                <Td className="text-muted-foreground">{CHANNEL_LABEL[o.channel]}</Td>
                <Td className="whitespace-nowrap text-right tabular-nums">{formatMoney(o.total)}</Td>
                <Td>
                  <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
