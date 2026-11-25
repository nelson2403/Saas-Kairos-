import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/dal";
import { CATALOG_ROLES, categoryPaths, listCategories, listUnits } from "@/modules/inventory/service";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "Novo produto" };

export default function NewProductPage() {
  return (
    <>
      <PageHeader title="Novo produto" />
      <Card>
        <Suspense fallback={<SectionSkeleton lines={4} />}>
          <Form />
        </Suspense>
      </Card>
    </>
  );
}

async function Form() {
  await requireRole(CATALOG_ROLES);
  const [categories, units] = await Promise.all([listCategories().then(categoryPaths), listUnits()]);
  return <ProductForm product={null} categories={categories} units={units} canEdit unitLocked={false} />;
}
