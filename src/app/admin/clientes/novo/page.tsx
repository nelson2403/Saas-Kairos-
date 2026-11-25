import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/dal";
import { CUSTOMER_ROLES } from "@/modules/partners/service";
import { CustomerForm } from "../customer-form";

export const metadata: Metadata = { title: "Novo cliente" };

export default function NewCustomerPage() {
  return (
    <>
      <PageHeader title="Novo cliente">
        <Link href="/admin/clientes" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft aria-hidden /> Clientes
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
  await requireRole(CUSTOMER_ROLES);
  return <CustomerForm customer={null} canEdit />;
}
