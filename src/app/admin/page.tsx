import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardDescription, CardTitle, Badge } from "@/components/ui/card";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { PLANNED_MODULES } from "@/config/modules";
import { requireMembership } from "@/lib/auth/dal";

export default function DashboardPage() {
  return (
    <>
      <Suspense fallback={<PageHeader title="Início" />}>
        <Greeting />
      </Suspense>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Indicadores</CardTitle>
          <CardDescription className="mt-1">
            Faturamento, vendas, ticket médio, estoque baixo e demais indicadores passam a ser calculados a partir
            dos dados reais conforme os módulos de estoque (Fase 2) e vendas/financeiro (Fase 5) forem entregues.
            Nenhum número é exibido antes de existir no banco.
          </CardDescription>
        </Card>

        <Card>
          <CardTitle>Aplicativo</CardTitle>
          <div className="mt-3">
            <InstallPrompt showUnsupported />
          </div>
          <Link href="/admin/status" className="mt-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            Status de conexão e sincronização <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Card>

        <Card className="lg:col-span-3">
          <CardTitle>Módulos em construção</CardTitle>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {PLANNED_MODULES.map((m) => (
              <li key={m.slug}>
                <Link href={m.href} className="flex items-center gap-3 rounded-md border border-border p-3 hover:bg-muted/50">
                  <m.icon className="size-4 text-muted-foreground" aria-hidden />
                  <span className="flex-1 text-sm">{m.label}</span>
                  <Badge>Fase {m.phase}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

async function Greeting() {
  const { user, companyName } = await requireMembership();
  const firstName = user.fullName?.split(" ")[0];
  return <PageHeader title={firstName ? `Olá, ${firstName}` : "Início"} description={companyName} />;
}
