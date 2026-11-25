import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, ShoppingCart } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { EmptyState, Table, Td, Th } from "@/components/ui/table";
import { requireMembership } from "@/lib/auth/dal";
import { formatMoney } from "@/modules/inventory/domain";
import { canEditSuppliers, getSupplier } from "@/modules/partners/service";
import { PURCHASE_STATUS_LABEL, PURCHASE_STATUS_TONE, formatPurchaseNumber } from "@/modules/purchasing/domain";
import { canManagePurchases, listPurchaseOrders } from "@/modules/purchasing/service";
import { SupplierForm } from "../supplier-form";

export const metadata: Metadata = { title: "Fornecedor" };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });

export default function SupplierPage(props: PageProps<"/admin/fornecedores/[id]">) {
  return (
    <Suspense fallback={<SectionSkeleton lines={4} />}>
      <Detail {...props} />
    </Suspense>
  );
}

async function Detail({ params, searchParams }: PageProps<"/admin/fornecedores/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [{ role }, data, orders] = await Promise.all([requireMembership(), getSupplier(id), listPurchaseOrders({ supplierId: id })]);
  if (!data) notFound();
  const { supplier, materials } = data;

  return (
    <>
      <PageHeader title={supplier.trade_name || supplier.name} description={supplier.trade_name ? supplier.name : undefined}>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/fornecedores" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft aria-hidden /> Fornecedores
          </Link>
          {canManagePurchases(role) && supplier.status === "active" && (
            <Link href={`/admin/compras/novo?fornecedor=${id}`} className={buttonVariants()}>
              <ShoppingCart aria-hidden /> Novo pedido
            </Link>
          )}
        </div>
      </PageHeader>
      {sp.criado && (
        <p role="status" className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">
          Fornecedor cadastrado.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle className="mb-4">Cadastro</CardTitle>
          <SupplierForm supplier={supplier} canEdit={canEditSuppliers(role)} />
        </Card>
        <Card>
          <CardTitle className="mb-3">Fornecedor preferencial de</CardTitle>
          {materials.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma matéria-prima. Defina o fornecedor preferencial no cadastro de cada matéria-prima.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {materials.map((m) => (
                <li key={m.id}>
                  <Link href={`/admin/materias-primas/${m.id}`} className="hover:underline">
                    {m.name}
                  </Link>
                  {m.code && <span className="text-muted-foreground"> · {m.code}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="lg:col-span-3">
          <CardTitle className="mb-4">Pedidos de compra</CardTitle>
          {orders.rows.length === 0 ? (
            <EmptyState title="Nenhum pedido para este fornecedor." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Pedido</Th>
                  <Th>Data</Th>
                  <Th className="text-right">Total</Th>
                  <Th>Situação</Th>
                </tr>
              </thead>
              <tbody>
                {orders.rows.map((o) => (
                  <tr key={o.id}>
                    <Td>
                      <Link href={`/admin/compras/${o.id}`} className="font-medium hover:underline">
                        {formatPurchaseNumber(o.number)}
                      </Link>
                    </Td>
                    <Td>{dateFormat.format(new Date(o.created_at))}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(o.total)}</Td>
                    <Td>
                      <Badge tone={PURCHASE_STATUS_TONE[o.status]}>{PURCHASE_STATUS_LABEL[o.status]}</Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
