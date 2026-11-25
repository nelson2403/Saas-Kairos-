import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/dal";
import { SUPPLIER_ROLES } from "@/modules/partners/service";
import { SupplierForm } from "../supplier-form";

export const metadata: Metadata = { title: "Novo fornecedor" };

export default function NewSupplierPage() {
  return (
    <>
      <PageHeader title="Novo fornecedor">
        <Link href="/admin/fornecedores" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft aria-hidden /> Fornecedores
        </Link>
      </PageHeader>
      <Card>
        <Suspense fallback={<SectionSkeleton lines={4} />}>
          <Form />
        </Suspense>
      </Card>
    </>
  );
}

async function Form() {
  await requireRole(SUPPLIER_ROLES);
  return <SupplierForm supplier={null} canEdit />;
}
