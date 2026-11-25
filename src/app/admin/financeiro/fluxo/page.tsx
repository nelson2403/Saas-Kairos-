import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { PeriodFilter, StatCard } from "@/components/reports/period-filter";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Table, Td, Th } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/dal";
import { parsePeriod } from "@/modules/finance/domain";
import { FINANCE_ROLES, cashFlow } from "@/modules/finance/service";
import { formatMoney } from "@/modules/inventory/domain";
import { todayBR } from "@/modules/sales/domain";

export const metadata: Metadata = { title: "Fluxo de caixa" };

const fmtDate = (d: string) => new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

export default function CashFlowPage({ searchParams }: PageProps<"/admin/financeiro/fluxo">) {
  return (
    <>
      <PageHeader title="Fluxo de caixa" description="Entradas e saídas efetivamente liquidadas, por dia.">
        <Link href="/admin/financeiro" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft aria-hidden /> Financeiro
        </Link>
      </PageHeader>
      <Card>
        <Suspense fallback={<SectionSkeleton />}>
          <Flow searchParams={searchParams} />
        </Suspense>
      </Card>
    </>
  );
}

async function Flow({ searchParams }: { searchParams: PageProps<"/admin/financeiro/fluxo">["searchParams"] }) {
  await requireRole(FINANCE_ROLES);
  const sp = await searchParams;
  const today = todayBR();
  const { from, to } = parsePeriod(sp.de, sp.ate, today);
  const days = await cashFlow(from, to);
  const income = days.reduce((s, d) => s + d.income, 0);
  const expense = days.reduce((s, d) => s + d.expense, 0);

  return (
    <>
      <PeriodFilter action="/admin/financeiro/fluxo" from={from} to={to} today={today} />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Entradas" value={formatMoney(income)} tone="success" />
        <StatCard label="Saídas" value={formatMoney(expense)} tone="danger" />
        <StatCard label="Resultado do período" value={formatMoney(income - expense)} tone={income - expense < 0 ? "danger" : undefined} />
      </div>
      {days.length === 0 ? (
        <EmptyState title="Nenhuma movimentação de caixa no período." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Dia</Th>
              <Th className="text-right">Entradas</Th>
              <Th className="text-right">Saídas</Th>
              <Th className="text-right">Resultado do dia</Th>
              <Th className="text-right">Acumulado</Th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date}>
                <Td className="whitespace-nowrap">{fmtDate(d.date)}</Td>
                <Td className="text-right tabular-nums text-success">{d.income ? formatMoney(d.income) : "—"}</Td>
                <Td className="text-right tabular-nums text-danger">{d.expense ? formatMoney(d.expense) : "—"}</Td>
                <Td className={`text-right tabular-nums ${d.net < 0 ? "text-danger" : ""}`}>{formatMoney(d.net)}</Td>
                <Td className={`text-right tabular-nums font-medium ${d.balance < 0 ? "text-danger" : ""}`}>{formatMoney(d.balance)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
