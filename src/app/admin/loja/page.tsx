import type { Metadata } from "next";
import { Suspense } from "react";
import { ExternalLink } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { getEditorData } from "@/modules/storefront/service";
import { StoreEditor } from "./store-editor";
import { VersionList } from "./version-list";

export const metadata: Metadata = { title: "Personalizar minha loja" };

export default function StoreEditorPage() {
  return (
    <>
      <PageHeader title="Personalizar minha loja" description="Edite à vontade no rascunho; os clientes só veem o que você publicar.">
        <a href="/" target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}>
          <ExternalLink aria-hidden /> Ver loja publicada
        </a>
      </PageHeader>
      <Suspense fallback={<SectionSkeleton lines={4} />}>
        <Editor />
      </Suspense>
    </>
  );
}

async function Editor() {
  const data = await getEditorData();
  return (
    <div className="space-y-4">
      <StoreEditor
        initial={data.draft}
        companyId={data.companyId}
        canEdit={data.canEdit}
        categories={data.categories}
        draftUpdatedAt={data.draftUpdatedAt}
        publishedVersion={data.publishedVersion}
        publishedAt={data.publishedAt}
      />
      <Card>
        <CardTitle className="mb-3">Versões publicadas</CardTitle>
        <VersionList versions={data.versions} people={data.people} current={data.publishedVersion} canEdit={data.canEdit} />
      </Card>
    </div>
  );
}
