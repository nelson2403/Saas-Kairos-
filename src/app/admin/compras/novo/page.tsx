import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/dal";
import { CATALOG_ROLES, listMovableItems, listUnits } from "@/modules/inventory/service";
import { listSupplierOptions } from "@/modules/partners/service";
import { PurchaseEditor } from "../purchase-editor";

export const metadata: Metadata = { title: "Novo pedido de compra" };

export default function NewPurchasePage({ searchParams }: PageProps<"/admin/compras/novo">) {
  return (
    <>
      <PageHeader title="Novo pedido de compra" description="O pedido não mexe no estoque; a entrada acontece no recebimento.">
        <Link href="/admin/compras" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft aria-hidden /> Compras
        </Link>
      </PageHeader>
      <Card>
        <Suspense fallback={<SectionSkeleton lines={3} />}>
          <Editor searchParams={searchParams} />
        </Suspense>
      </Card>
    </>
  );
}

async function Editor({ searchParams }: { searchParams: PageProps<"/admin/compras/novo">["searchParams"] }) {
  const [sp] = await Promise.all([searchParams, requireRole(CATALOG_ROLES)]);
  const [suppliers, items, units] = await Promise.all([listSupplierOptions(), listMovableItems(), listUnits()]);
  const fornecedor = typeof sp.fornecedor === "string" && suppliers.some((s) => s.id === sp.fornecedor) ? sp.fornecedor : undefined;
  return <PurchaseEditor suppliers={suppliers} items={items} units={units} initial={null} initialSupplier={fornecedor} />;
}
