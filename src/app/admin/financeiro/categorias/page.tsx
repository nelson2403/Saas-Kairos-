import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/dal";
import { FINANCE_ROLES, listCategories } from "@/modules/finance/service";
import { CategoryForm } from "./category-form";

export const metadata: Metadata = { title: "Categorias financeiras" };

export default function CategoriesPage() {
  return (
    <>
      <PageHeader title="Categorias financeiras">
        <Link href="/admin/financeiro" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft aria-hidden /> Financeiro
        </Link>
      </PageHeader>
      <Suspense fallback={<SectionSkeleton />}>
        <List />
      </Suspense>
    </>
  );
}

async function List() {
  await requireRole(FINANCE_ROLES);
  const categories = await listCategories();
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {(["income", "expense"] as const).map((type) => (
        <Card key={type}>
          <CardTitle className="mb-3">{type === "income" ? "Receitas" : "Despesas"}</CardTitle>
          <ul className="space-y-1 text-sm">
            {categories
              .filter((c) => c.type === type)
              .map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  {c.name}
                  {c.company_id === null && <Badge>Padrão</Badge>}
                </li>
              ))}
          </ul>
        </Card>
      ))}
      <Card>
        <CardTitle className="mb-3">Nova categoria</CardTitle>
        <CategoryForm />
      </Card>
    </div>
  );
}
