import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { EmptyState, Table, Td, Th } from "@/components/ui/table";
import { LinkTabs } from "@/components/ui/tabs";
import { requireMembership } from "@/lib/auth/dal";
import { formatMoney } from "@/modules/inventory/domain";
import { CHANNEL_LABEL, ORDER_STATUS_LABEL, ORDER_STATUS_TONE, formatOrderNumber } from "@/modules/sales/domain";
import { ORDERS_PAGE_SIZE, canSell, listOrders } from "@/modules/sales/service";

export const metadata: Metadata = { title: "Pedidos" };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

const TABS = [
  { key: "aguardando", label: "Aguardando pagamento" },
  { key: "pagos", label: "Pagos (a entregar)" },
  { key: "entregues", label: "Entregues" },
  { key: "encerrados", label: "Cancelados e estornados" },
  { key: "todos", label: "Todos" },
];

export default function OrdersPage({ searchParams }: PageProps<"/admin/pedidos">) {
  return (
    <>
      <PageHeader title="Pedidos" description="O pedido reserva o estoque; a venda só é efetivada quando o pagamento é registrado.">
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
  if (!canSell(role)) return null;
  return (
    <Link href="/admin/pedidos/novo" className={buttonVariants()}>
      <Plus aria-hidden /> Novo pedido
    </Link>
  );
}

async function List({ searchParams }: { searchParams: PageProps<"/admin/pedidos">["searchParams"] }) {
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.ver) ?? TABS[0];
  const page = Math.max(1, Number(sp.pagina) || 1);
  const { rows, total } = await listOrders({ group: tab.key === "todos" ? undefined : tab.key, page });
  const pages = Math.ceil(total / ORDERS_PAGE_SIZE);
  const href = (p: number) => `/admin/pedidos?ver=${tab.key}${p > 1 ? `&pagina=${p}` : ""}`;

  return (
    <>
      <LinkTabs active={tab.key} items={TABS.map((t) => ({ ...t, href: `/admin/pedidos?ver=${t.key}` }))} />
      {rows.length === 0 ? (
        <EmptyState title="Nenhum pedido aqui." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Pedido</Th>
              <Th>Cliente</Th>
              <Th>Canal</Th>
              <Th className="text-right">Total</Th>
              <Th>Situação</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="hover:bg-muted/40">
                <Td className="whitespace-nowrap">
                  <Link href={`/admin/pedidos/${o.id}`} className="font-medium hover:underline">
                    {formatOrderNumber(o.number)}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{dateFormat.format(new Date(o.created_at))}</span>
                </Td>
                <Td>{o.customer?.name ?? <span className="text-muted-foreground">Sem cliente</span>}</Td>
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
      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginação">
          <span className="text-muted-foreground">
            Página {page} de {pages} · {total} pedidos
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={href(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Anterior
              </Link>
            )}
            {page < pages && (
              <Link href={href(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Próxima
              </Link>
            )}
          </div>
        </nav>
      )}
    </>
  );
}
