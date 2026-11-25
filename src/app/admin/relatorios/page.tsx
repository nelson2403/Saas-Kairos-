import type { Metadata } from "next";
import { Suspense } from "react";
import { Download } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { PeriodFilter } from "@/components/reports/period-filter";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Table, Td, Th } from "@/components/ui/table";
import { LinkTabs } from "@/components/ui/tabs";
import { requireMembership } from "@/lib/auth/dal";
import { parsePeriod } from "@/modules/finance/domain";
import { canSeeFinance } from "@/modules/finance/service";
import { formatMoney, formatQuantity } from "@/modules/inventory/domain";
import { REPORTS, buildReport, type ColumnType, type ReportKey } from "@/modules/reports/service";
import { todayBR } from "@/modules/sales/domain";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Relatórios" };

function cell(value: string | number | null | undefined, type: ColumnType) {
  if (value == null || value === "") return "—";
  if (typeof value === "string" && type !== "date") return value;
  switch (type) {
    case "money":
      return formatMoney(value);
    case "qty":
      return formatQuantity(value);
    case "percent":
      return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    case "date":
      return String(value).split("-").reverse().join("/");
    default:
      return String(value);
  }
}

export default function ReportsPage({ searchParams }: PageProps<"/admin/relatorios">) {
  return (
    <>
      <PageHeader title="Relatórios" description="Exporte em Excel ou imprima / salve em PDF." />
      <Suspense fallback={<SectionSkeleton />}>
        <ReportView searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ReportView({ searchParams }: { searchParams: PageProps<"/admin/relatorios">["searchParams"] }) {
  const { role } = await requireMembership();
  if (!canSeeFinance(role)) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">Relatórios gerenciais são visíveis para proprietário, administrador e gerente.</p>
      </Card>
    );
  }
  const sp = await searchParams;
  const key = (typeof sp.tipo === "string" && sp.tipo in REPORTS ? sp.tipo : "vendas-pedidos") as ReportKey;
  const today = todayBR();
  const { from, to } = REPORTS[key].period ? parsePeriod(sp.de, sp.ate, today) : { from: today, to: today };
  const report = await buildReport(key, from, to);
  const qs = new URLSearchParams({ tipo: key, de: from, ate: to });

  return (
    <Card>
      <div className="print:hidden">
        <LinkTabs
          active={key}
          items={(Object.keys(REPORTS) as ReportKey[]).map((k) => ({
            key: k,
            label: REPORTS[k].label,
            href: `/admin/relatorios?${new URLSearchParams({ tipo: k, ...(REPORTS[k].period ? { de: from, ate: to } : {}) })}`,
          }))}
        />
        {REPORTS[key].period && <PeriodFilter action="/admin/relatorios" from={from} to={to} today={today} hidden={{ tipo: key }} />}
      </div>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">{report.title}</h2>
          <p className="text-sm text-muted-foreground">{report.subtitle}</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <a href={`/admin/relatorios/exportar?${qs}`} className={buttonVariants({ variant: "outline" })} download>
            <Download aria-hidden /> Excel
          </a>
          <PrintButton />
        </div>
      </div>

      {report.rows.length === 0 ? (
        <EmptyState title="Sem dados para este relatório no período." />
      ) : (
        <Table>
          <thead>
            <tr>
              {report.columns.map((c) => (
                <Th key={c.key} className={c.type === "text" || c.type === "date" ? "" : "text-right"}>
                  {c.label}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row, i) => (
              <tr key={i}>
                {report.columns.map((c) => (
                  <Td key={c.key} className={c.type === "text" || c.type === "date" ? "" : "whitespace-nowrap text-right tabular-nums"}>
                    {cell(row[c.key], c.type)}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
          {report.totals && (
            <tfoot>
              <tr className="font-medium">
                {report.columns.map((c) => (
                  <Td key={c.key} className={c.type === "text" || c.type === "date" ? "" : "whitespace-nowrap text-right tabular-nums"}>
                    {report.totals![c.key] == null ? "" : cell(report.totals![c.key], typeof report.totals![c.key] === "string" ? "text" : c.type)}
                  </Td>
                ))}
              </tr>
            </tfoot>
          )}
        </Table>
      )}
      {report.note && <p className="mt-3 text-xs text-muted-foreground">{report.note}</p>}
    </Card>
  );
}
