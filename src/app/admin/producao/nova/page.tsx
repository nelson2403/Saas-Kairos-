import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/dal";
import { STOCK_ROLES } from "@/modules/inventory/service";
import { listProducibleProducts } from "@/modules/production/service";
import { OrderForm } from "./order-form";

export const metadata: Metadata = { title: "Nova ordem de produção" };

export default function NewOrderPage({ searchParams }: PageProps<"/admin/producao/nova">) {
  return (
    <>
      <PageHeader title="Nova ordem de produção" description="Abrir a ordem não mexe no estoque. A baixa dos insumos acontece ao concluir.">
        <Link href="/admin/producao" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft aria-hidden /> Produção
        </Link>
      </PageHeader>
      <Card>
        <Suspense fallback={<SectionSkeleton lines={2} />}>
          <Form searchParams={searchParams} />
        </Suspense>
      </Card>
    </>
  );
}

async function Form({ searchParams }: { searchParams: PageProps<"/admin/producao/nova">["searchParams"] }) {
  const [sp] = await Promise.all([searchParams, requireRole(STOCK_ROLES)]);
  const products = await listProducibleProducts();
  const initial = typeof sp.produto === "string" ? sp.produto : "";
  return <OrderForm products={products} initialProduct={products.some((p) => p.id === initial) ? initial : ""} />;
}
