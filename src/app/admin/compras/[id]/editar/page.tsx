import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/dal";
import { CATALOG_ROLES, listMovableItems, listUnits } from "@/modules/inventory/service";
import { listSupplierOptions } from "@/modules/partners/service";
import { formatPurchaseNumber } from "@/modules/purchasing/domain";
import { getPurchaseOrder } from "@/modules/purchasing/service";
import { PurchaseEditor } from "../../purchase-editor";

export const metadata: Metadata = { title: "Editar pedido de compra" };

export default function EditPurchasePage(props: PageProps<"/admin/compras/[id]/editar">) {
  return (
    <Suspense fallback={<SectionSkeleton lines={3} />}>
      <Editor {...props} />
    </Suspense>
  );
}

async function Editor({ params }: PageProps<"/admin/compras/[id]/editar">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  await requireRole(CATALOG_ROLES);
  const [order, suppliers, items, units] = await Promise.all([getPurchaseOrder(id), listSupplierOptions(), listMovableItems(), listUnits()]);
  if (!order) notFound();
  if (!["draft", "ordered"].includes(order.status) || order.receipts.length > 0) redirect(`/admin/compras/${id}`);

  return (
    <>
      <PageHeader title={`Editar ${formatPurchaseNumber(order.number)}`}>
        <Link href={`/admin/compras/${id}`} className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft aria-hidden /> Voltar ao pedido
        </Link>
      </PageHeader>
      <Card>
        <PurchaseEditor
          suppliers={suppliers}
          items={items}
          units={units}
          initial={{
            orderId: order.id,
            supplierId: order.supplier.id,
            expectedDate: order.expected_date,
            notes: order.notes,
            items: order.items.map((i) => ({
              item: i.product_id ? `product:${i.product_id}` : `raw_material:${i.raw_material_id}`,
              quantity: i.quantity,
              unitId: i.unit_id,
              unitPrice: i.unit_price,
            })),
          }}
        />
      </Card>
    </>
  );
}
