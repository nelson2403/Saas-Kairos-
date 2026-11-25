import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { requireMembership } from "@/lib/auth/dal";
import { canManageCatalog, categoryPaths, listCategories } from "@/modules/inventory/service";
import { CategoryManager } from "./category-manager";

export const metadata: Metadata = { title: "Categorias" };

export default function CategoriesPage() {
  return (
    <>
      <PageHeader title="Categorias" description="Organizam os produtos no painel e, depois, na loja." />
      <Card>
        <Suspense fallback={<SectionSkeleton />}>
          <Categories />
        </Suspense>
      </Card>
    </>
  );
}

async function Categories() {
  const { role } = await requireMembership();
  const categories = categoryPaths(await listCategories());
  return <CategoryManager categories={categories} canEdit={canManageCatalog(role)} />;
}
