import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { SectionSkeleton } from "@/components/layout/page-header";
import { receiptOrderId } from "@/modules/purchasing/service";

/** Link das movimentações de estoque: leva ao pedido do recebimento. */
export default function ReceiptRedirect(props: PageProps<"/admin/compras/recebimento/[id]">) {
  return (
    <Suspense fallback={<SectionSkeleton lines={2} />}>
      <Go {...props} />
    </Suspense>
  );
}

async function Go({ params }: PageProps<"/admin/compras/recebimento/[id]">): Promise<React.ReactNode> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const orderId = await receiptOrderId(id);
  if (!orderId) notFound();
  redirect(`/admin/compras/${orderId}`);
}
