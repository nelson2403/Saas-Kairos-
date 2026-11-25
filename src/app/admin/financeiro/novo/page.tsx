import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/dal";
import { FINANCE_ROLES, listCategories } from "@/modules/finance/service";
import { listSupplierOptions } from "@/modules/partners/service";
import { TransactionForm } from "../transaction-form";

export const metadata: Metadata = { title: "Novo lançamento" };

export default function NewTransactionPage({ searchParams }: PageProps<"/admin/financeiro/novo">) {
  return (
    <>
      <PageHeader title="Novo lançamento" description="Despesas (aluguel, contas, impostos…) e receitas que não vêm de pedidos.">
        <Link href="/admin/financeiro" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft aria-hidden /> Financeiro
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

async function Form({ searchParams }: { searchParams: PageProps<"/admin/financeiro/novo">["searchParams"] }) {
  const [sp] = await Promise.all([searchParams, requireRole(FINANCE_ROLES)]);
  const [categories, suppliers] = await Promise.all([listCategories(), listSupplierOptions()]);
  return (
    <TransactionForm
      transaction={null}
      categories={categories}
      suppliers={suppliers.filter((s) => s.status === "active")}
      defaultType={sp.tipo === "receita" ? "income" : "expense"}
    />
  );
}
