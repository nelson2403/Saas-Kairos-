import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/dal";
import { STOCK_ROLES } from "@/modules/inventory/service";
import { listCustomerOptions, listSellableProducts } from "@/modules/sales/service";
import { OrderForm } from "../order-form";

export const metadata: Metadata = { title: "Novo pedido" };

export default function NewOrderPage({ searchParams }: PageProps<"/admin/pedidos/novo">) {
  return (
    <>
      <PageHeader title="Novo pedido ou venda">
        <Link href="/admin/pedidos" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft aria-hidden /> Pedidos
        </Link>
      </PageHeader>
      <Card>
        <Suspense fallback={<SectionSkeleton lines={3} />}>
          <Form searchParams={searchParams} />
        </Suspense>
      </Card>
    </>
  );
}

async function Form({ searchParams }: { searchParams: PageProps<"/admin/pedidos/novo">["searchParams"] }) {
  const [sp] = await Promise.all([searchParams, requireRole(STOCK_ROLES)]);
  const [products, customers] = await Promise.all([listSellableProducts(), listCustomerOptions()]);
  const cliente = typeof sp.cliente === "string" && customers.some((c) => c.id === sp.cliente) ? sp.cliente : undefined;
  return <OrderForm products={products} customers={customers} payNowDefault={sp.pago === "1"} initialCustomer={cliente} />;
}
