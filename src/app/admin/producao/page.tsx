import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BookOpenText, Plus } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { EmptyState, Table, Td, Th } from "@/components/ui/table";
import { LinkTabs } from "@/components/ui/tabs";
import { requireMembership } from "@/lib/auth/dal";
import { formatCost, formatQuantity } from "@/modules/inventory/domain";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, formatOrderNumber, type OrderStatus } from "@/modules/production/domain";
import { ORDERS_PAGE_SIZE, canProduce, listOrders } from "@/modules/production/service";

export const metadata: Metadata = { title: "Produção" };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

const TABS: { key: string; label: string; status?: OrderStatus }[] = [
  { key: "abertas", label: "Em aberto", status: "planned" },
  { key: "concluidas", label: "Concluídas", status: "completed" },
  { key: "todas", label: "Todas" },
];

export default function ProductionPage({ searchParams }: PageProps<"/admin/producao">) {
  return (
    <>
      <PageHeader title="Produção" description="Ordens de produção: consomem as matérias-primas da ficha técnica e lançam o produto no estoque.">
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/producao/fichas" className={buttonVariants({ variant: "outline" })}>
            <BookOpenText aria-hidden /> Fichas técnicas
          </Link>
          <Suspense>
            <NewButton />
          </Suspense>
        </div>
      </PageHeader>
      <Card>
        <Suspense fallback={<SectionSkeleton />}>
          <Orders searchParams={searchParams} />
        </Suspense>
      </Card>
    </>
  );
}

async function NewButton() {
  const { role } = await requireMembership();
  if (!canProduce(role)) return null;
  return (
    <Link href="/admin/producao/nova" className={buttonVariants()}>
      <Plus aria-hidden /> Nova ordem
    </Link>
  );
}

async function Orders({ searchParams }: { searchParams: PageProps<"/admin/producao">["searchParams"] }) {
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.ver) ?? TABS[0];
  const page = Math.max(1, Number(sp.pagina) || 1);
  const { rows, total } = await listOrders({ status: tab.status, page });
  const pages = Math.ceil(total / ORDERS_PAGE_SIZE);
  const href = (p: number) => `/admin/producao?ver=${tab.key}${p > 1 ? `&pagina=${p}` : ""}`;

  return (
    <>
      <LinkTabs active={tab.key} items={TABS.map((t) => ({ key: t.key, label: t.label, href: `/admin/producao?ver=${t.key}` }))} />
      {rows.length === 0 ? (
        <EmptyState title={tab.status === "planned" ? "Nenhuma ordem em aberto." : "Nenhuma ordem de produção."}>
          Para produzir, o produto precisa de uma <Link href="/admin/producao/fichas" className="underline">ficha técnica</Link>.
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Ordem</Th>
              <Th>Produto</Th>
              <Th className="text-right">Planejado</Th>
              <Th className="text-right">Produzido</Th>
              <Th className="text-right">Custo unitário</Th>
              <Th>Situação</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="hover:bg-muted/40">
                <Td className="whitespace-nowrap">
                  <Link href={`/admin/producao/${o.id}`} className="font-medium hover:underline">
                    {formatOrderNumber(o.number)}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{dateFormat.format(new Date(o.completed_at ?? o.created_at))}</span>
                </Td>
                <Td>{o.product.name}</Td>
                <Td className="whitespace-nowrap text-right tabular-nums">{formatQuantity(o.planned_quantity, o.product.unit.code)}</Td>
                <Td className="whitespace-nowrap text-right tabular-nums">
                  {o.produced_quantity == null ? "—" : formatQuantity(o.produced_quantity, o.product.unit.code)}
                </Td>
                <Td className="whitespace-nowrap text-right tabular-nums">
                  {o.unit_cost == null ? "—" : formatCost(o.unit_cost)}
                  {o.cost_complete === false && <span className="block text-xs text-warning">incompleto</span>}
                </Td>
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
            Página {page} de {pages} · {total} ordens
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
