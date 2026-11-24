import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Construction } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, Badge } from "@/components/ui/card";
import { PLANNED_MODULES, findModule } from "@/config/modules";

/**
 * Página de status para módulos ainda não entregues. Não simula funcionalidade:
 * informa o que o módulo fará e em qual fase. Quando o módulo for implementado,
 * a rota específica (app/admin/<slug>/page.tsx) passa a ter precedência.
 */
export function generateStaticParams() {
  return PLANNED_MODULES.map((m) => ({ modulo: m.slug }));
}

export async function generateMetadata({ params }: PageProps<"/admin/[modulo]">): Promise<Metadata> {
  const { modulo } = await params;
  return { title: findModule(modulo)?.label ?? "Módulo" };
}

export default async function PlannedModulePage({ params }: PageProps<"/admin/[modulo]">) {
  const { modulo } = await params;
  const mod = PLANNED_MODULES.find((m) => m.slug === modulo);
  if (!mod) notFound();

  return (
    <>
      <PageHeader title={mod.label}>
        <Badge tone="warning">Previsto para a Fase {mod.phase}</Badge>
      </PageHeader>
      <Card className="flex items-start gap-4">
        <Construction className="mt-0.5 size-6 shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <p>{mod.summary}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Este módulo ainda não está disponível. O andamento de cada fase está em PROJECT_STATUS.md.
          </p>
        </div>
      </Card>
    </>
  );
}
