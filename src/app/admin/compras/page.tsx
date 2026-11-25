import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus, Truck } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { EmptyState, Table, Td, Th } from "@/components/ui/table";
import { LinkTabs } from "@/components/ui/tabs";
import { requireMembership } from "@/lib/auth/dal";
import { formatMoney } from "@/modules/inventory/domain";
import { PURCHASE_STATUS_LABEL, PURCHASE_STATUS_TONE, formatPurchaseNumber } from "@/modules/purchasing/domain";
import { PURCHASES_PAGE_SIZE, canManagePurchases, listPurchaseOrders } from "@/modules/purchasing/service";

export const metadata: Metadata = { title: "Compras" };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });

const TABS = [
  { key: "abertos", label: "Em aberto" },
  { key: "recebidos", label: "Recebidos" },
  { key: "cancelados", label: "Cancelados" },
  { key: "todos", label: "Todos" },
];

export default function PurchasesPage({ searchParams }: PageProps<"/admin/compras">) {
  return (
    <>
      <PageHeader title="Compras" description="Pedidos aos fornecedores. A mercadoria só entra no estoque ao registrar o recebimento.">
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/fornecedores" className={buttonVariants({ variant: "outline" })}>
            <Truck aria-hidden /> Fornecedores
          </Link>
          <Suspense>
            <NewButton />
          </Suspense>
        </div>
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
  if (!canManagePurchases(role)) return null;
  return (
    <Link href="/admin/compras/novo" className={buttonVariants()}>
      <Plus aria-hidden /> Novo pedido
    </Link>
  );
}

async function List({ searchParams }: { searchParams: PageProps<"/admin/compras">["searchParams"] }) {
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.ver) ?? TABS[0];
  const page = Math.max(1, Number(sp.pagina) || 1);
  const { rows, total } = await listPurchaseOrders({ group: tab.key === "todos" ? undefined : tab.key, page });
  const pages = Math.ceil(total / PURCHASES_PAGE_SIZE);
  const href = (p: number) => `/admin/compras?ver=${tab.key}${p > 1 ? `&pagina=${p}` : ""}`;

  return (
    <>
      <LinkTabs active={tab.key} items={TABS.map((t) => ({ ...t, href: `/admin/compras?ver=${t.key}` }))} />
      {rows.length === 0 ? (
        <EmptyState title={tab.key === "abertos" ? "Nenhum pedido em aberto." : "Nenhum pedido."} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Pedido</Th>
              <Th>Fornecedor</Th>
              <Th>Previsão</Th>
              <Th className="text-right">Total</Th>
              <Th>Situação</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="hover:bg-muted/40">
                <Td className="whitespace-nowrap">
                  <Link href={`/admin/compras/${o.id}`} className="font-medium hover:underline">
                    {formatPurchaseNumber(o.number)}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{dateFormat.format(new Date(o.created_at))}</span>
                </Td>
                <Td>{o.supplier.name}</Td>
                <Td className="whitespace-nowrap">{o.expected_date ? dateFormat.format(new Date(`${o.expected_date}T12:00:00`)) : "—"}</Td>
                <Td className="whitespace-nowrap text-right tabular-nums">{formatMoney(o.total)}</Td>
                <Td>
                  <Badge tone={PURCHASE_STATUS_TONE[o.status]}>{PURCHASE_STATUS_LABEL[o.status]}</Badge>
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
