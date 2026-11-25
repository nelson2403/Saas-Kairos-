import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/dal";
import { CATALOG_ROLES, listUnits } from "@/modules/inventory/service";
import { listSupplierOptions } from "@/modules/partners/service";
import { RawMaterialForm } from "../raw-material-form";

export const metadata: Metadata = { title: "Nova matéria-prima" };

export default function NewRawMaterialPage() {
  return (
    <>
      <PageHeader title="Nova matéria-prima" />
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
  const [units, suppliers] = await Promise.all([listUnits(), listSupplierOptions()]);
  return <RawMaterialForm material={null} units={units} canEdit unitLocked={false} suppliers={suppliers} />;
}
