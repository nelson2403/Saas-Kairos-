import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardDescription, CardTitle, Badge } from "@/components/ui/card";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { PLANNED_MODULES } from "@/config/modules";
import { requireMembership } from "@/lib/auth/dal";
import { countBelowMin } from "@/modules/inventory/service";
import { countOpenOrders } from "@/modules/production/service";
import { countPendingPurchases } from "@/modules/purchasing/service";
import { monthRange } from "@/modules/finance/domain";
import { canSeeFinance, openTotals } from "@/modules/finance/service";
import { formatMoney } from "@/modules/inventory/domain";
import { todayBR } from "@/modules/sales/domain";
import { countPendingOrders, salesSummary } from "@/modules/sales/service";

export default function DashboardPage() {
  return (
    <>
      <Suspense fallback={<PageHeader title="Início" />}>
        <Greeting />
      </Suspense>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Indicadores</CardTitle>
          <Suspense fallback={<div className="mt-3 h-24 animate-pulse rounded-md bg-muted" />}>
            <SalesIndicators />
          </Suspense>
          <Suspense fallback={<div className="mt-3 h-16 animate-pulse rounded-md bg-muted" />}>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <OrdersIndicator />
              <FinanceIndicator />
              <StockIndicator />
              <ProductionIndicator />
              <PurchaseIndicator />
            </div>
          </Suspense>
          <CardDescription className="mt-4">Todos os números vêm do banco, em tempo real. Vendas contam pela data do pagamento.</CardDescription>
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
          <CardTitle>Próximos módulos</CardTitle>
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

async function StockIndicator() {
  const below = await countBelowMin();
  return (
    <Link
      href="/admin/estoque?ver=baixo"
      className="flex items-center justify-between rounded-md border border-border p-4 hover:bg-muted/50"
    >
      <span>
        <span className="block text-sm text-muted-foreground">Itens abaixo do estoque mínimo</span>
        <span className="font-display text-3xl tabular-nums">{below}</span>
      </span>
      <Badge tone={below > 0 ? "warning" : "success"}>{below > 0 ? "Repor" : "Em dia"}</Badge>
    </Link>
  );
}

async function ProductionIndicator() {
  const open = await countOpenOrders();
  return (
    <Link href="/admin/producao" className="flex items-center justify-between rounded-md border border-border p-4 hover:bg-muted/50">
      <span>
        <span className="block text-sm text-muted-foreground">Ordens de produção em aberto</span>
        <span className="font-display text-3xl tabular-nums">{open}</span>
      </span>
      <Badge tone={open > 0 ? "warning" : "neutral"}>{open > 0 ? "Concluir" : "Nenhuma"}</Badge>
    </Link>
  );
}

async function PurchaseIndicator() {
  const pending = await countPendingPurchases();
  return (
    <Link href="/admin/compras" className="flex items-center justify-between rounded-md border border-border p-4 hover:bg-muted/50">
      <span>
        <span className="block text-sm text-muted-foreground">Compras aguardando recebimento</span>
        <span className="font-display text-3xl tabular-nums">{pending}</span>
      </span>
      <Badge tone={pending > 0 ? "warning" : "neutral"}>{pending > 0 ? "Conferir" : "Nenhuma"}</Badge>
    </Link>
  );
}

async function SalesIndicators() {
  await requireMembership(); // dado da requisição antes de ler a data (pré-renderização)
  const { from, to } = monthRange(todayBR());
  const s = await salesSummary(from, to);
  return (
    <Link href="/admin/vendas" className="mt-3 grid gap-3 rounded-md border border-border p-4 hover:bg-muted/50 sm:grid-cols-3">
      <span>
        <span className="block text-sm text-muted-foreground">Faturamento do mês</span>
        <span className="font-display text-3xl tabular-nums">{formatMoney(s.revenue)}</span>
      </span>
      <span>
        <span className="block text-sm text-muted-foreground">Vendas no mês</span>
        <span className="font-display text-3xl tabular-nums">{s.count}</span>
      </span>
      <span>
        <span className="block text-sm text-muted-foreground">Ticket médio</span>
        <span className="font-display text-3xl tabular-nums">{formatMoney(s.ticket)}</span>
      </span>
    </Link>
  );
}

async function OrdersIndicator() {
  const open = await countPendingOrders();
  return (
    <Link href="/admin/pedidos" className="flex items-center justify-between rounded-md border border-border p-4 hover:bg-muted/50">
      <span>
        <span className="block text-sm text-muted-foreground">Pedidos a receber ou entregar</span>
        <span className="font-display text-3xl tabular-nums">{open}</span>
      </span>
      <Badge tone={open > 0 ? "warning" : "neutral"}>{open > 0 ? "Acompanhar" : "Nenhum"}</Badge>
    </Link>
  );
}

async function FinanceIndicator() {
  const { role } = await requireMembership();
  if (!canSeeFinance(role)) return null;
  const t = await openTotals(todayBR());
  return (
    <Link href="/admin/financeiro" className="flex items-center justify-between rounded-md border border-border p-4 hover:bg-muted/50">
      <span>
        <span className="block text-sm text-muted-foreground">Contas vencidas</span>
        <span className="font-display text-3xl tabular-nums">{t.overdueCount}</span>
      </span>
      <Badge tone={t.overdueCount > 0 ? "danger" : "success"}>{t.overdueCount > 0 ? "Resolver" : "Em dia"}</Badge>
    </Link>
  );
}

async function Greeting() {
  const { user, companyName } = await requireMembership();
  const firstName = user.fullName?.split(" ")[0];
  return <PageHeader title={firstName ? `Olá, ${firstName}` : "Início"} description={companyName} />;
}
