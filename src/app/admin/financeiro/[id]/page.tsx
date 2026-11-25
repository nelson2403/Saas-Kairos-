import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/dal";
import { STATUS_LABEL, SOURCE_LABEL } from "@/modules/finance/domain";
import { FINANCE_ROLES, getTransaction, listCategories } from "@/modules/finance/service";
import { formatMoney } from "@/modules/inventory/domain";
import { listSupplierOptions } from "@/modules/partners/service";
import { PAYMENT_METHOD_LABEL } from "@/modules/sales/domain";
import { TransactionForm } from "../transaction-form";

export const metadata: Metadata = { title: "Lançamento" };

const fmtDate = (d: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

export default function TransactionPage(props: PageProps<"/admin/financeiro/[id]">) {
  return (
    <Suspense fallback={<SectionSkeleton lines={3} />}>
      <Detail {...props} />
    </Suspense>
  );
}

async function Detail({ params }: PageProps<"/admin/financeiro/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  await requireRole(FINANCE_ROLES);
  const [t, categories, suppliers] = await Promise.all([getTransaction(id), listCategories(), listSupplierOptions()]);
  if (!t) notFound();
  const editable = t.status === "open" && t.source_type !== "order" && t.source_type !== "order_refund";
  const sourceHref = t.source_type === "purchase_order" ? `/admin/compras/${t.source_id}` : t.source_id ? `/admin/pedidos/${t.source_id}` : null;

  return (
    <>
      <PageHeader title={t.description} description={`${t.type === "income" ? "Receita" : "Despesa"} · ${t.category.name}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={t.status === "paid" ? "success" : t.status === "open" ? "warning" : "neutral"} className="text-sm">
            {STATUS_LABEL[t.status]}
          </Badge>
          <Link href="/admin/financeiro" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft aria-hidden /> Financeiro
          </Link>
        </div>
      </PageHeader>
      <Card>
        {sourceHref && (
          <p className="mb-4 text-sm">
            Gerado por{" "}
            <Link href={sourceHref} className="underline">
              {SOURCE_LABEL[t.source_type!]}
            </Link>
            .
          </p>
        )}
        {t.status === "paid" && (
          <p className="mb-4 text-sm">
            Liquidado em {fmtDate(t.paid_at!)} · {formatMoney(t.paid_amount)}
            {t.payment_method && ` · ${PAYMENT_METHOD_LABEL[t.payment_method]}`}. Para alterar, desfaça a liquidação na lista.
          </p>
        )}
        {editable ? (
          <TransactionForm transaction={t} categories={categories} suppliers={suppliers} />
        ) : (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Valor</dt>
              <dd>{formatMoney(t.amount)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Vencimento</dt>
              <dd>{fmtDate(t.due_date)}</dd>
            </div>
            {t.notes && (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Observações</dt>
                <dd>{t.notes}</dd>
              </div>
            )}
          </dl>
        )}
      </Card>
    </>
  );
}
