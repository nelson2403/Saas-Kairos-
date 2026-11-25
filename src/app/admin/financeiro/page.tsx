import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LineChart, Plus, Tags } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { PeriodFilter, StatCard } from "@/components/reports/period-filter";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { EmptyState, Table, Td, Th } from "@/components/ui/table";
import { LinkTabs } from "@/components/ui/tabs";
import { requireMembership } from "@/lib/auth/dal";
import { SOURCE_LABEL, dueState, parsePeriod } from "@/modules/finance/domain";
import { canSeeFinance, listTransactions, openTotals, type Transaction, type TransactionView } from "@/modules/finance/service";
import { formatMoney } from "@/modules/inventory/domain";
import { PAYMENT_METHOD_LABEL, todayBR } from "@/modules/sales/domain";
import { SettleTransaction, StatusButton } from "./transaction-actions";

export const metadata: Metadata = { title: "Financeiro" };

const dateOnly = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" });
const fmtDate = (d: string) => dateOnly.format(new Date(`${d}T00:00:00Z`));

const TABS: { key: TransactionView; label: string }[] = [
  { key: "receber", label: "A receber" },
  { key: "pagar", label: "A pagar" },
  { key: "liquidados", label: "Liquidados" },
];

export default function FinancePage({ searchParams }: PageProps<"/admin/financeiro">) {
  return (
    <>
      <PageHeader title="Financeiro" description="Contas a receber e a pagar. O fluxo de caixa considera só o que foi liquidado.">
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/financeiro/categorias" className={buttonVariants({ variant: "ghost" })}>
            <Tags aria-hidden /> Categorias
          </Link>
          <Link href="/admin/financeiro/fluxo" className={buttonVariants({ variant: "outline" })}>
            <LineChart aria-hidden /> Fluxo de caixa
          </Link>
          <Link href="/admin/financeiro/novo" className={buttonVariants()}>
            <Plus aria-hidden /> Novo lançamento
          </Link>
        </div>
      </PageHeader>
      <Suspense fallback={<SectionSkeleton />}>
        <Finance searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Finance({ searchParams }: { searchParams: PageProps<"/admin/financeiro">["searchParams"] }) {
  const { role } = await requireMembership();
  if (!canSeeFinance(role)) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">O financeiro é visível para proprietário, administrador e gerente.</p>
      </Card>
    );
  }
  const sp = await searchParams;
  const today = todayBR();
  const tab = TABS.find((t) => t.key === sp.ver) ?? TABS[0];
  const period = parsePeriod(sp.de, sp.ate, today);
  const [totals, rows] = await Promise.all([
    openTotals(today),
    listTransactions(tab.key === "liquidados" ? { view: tab.key, from: period.from, to: period.to } : { view: tab.key }),
  ]);

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="A receber (em aberto)" value={formatMoney(totals.receivable)} hint={totals.overdueReceivable ? `${formatMoney(totals.overdueReceivable)} vencido` : undefined} />
        <StatCard label="A pagar (em aberto)" value={formatMoney(totals.payable)} hint={totals.overduePayable ? `${formatMoney(totals.overduePayable)} vencido` : undefined} />
        <StatCard label="Lançamentos vencidos" value={String(totals.overdueCount)} tone={totals.overdueCount ? "danger" : undefined} />
      </div>
      <Card>
        <LinkTabs active={tab.key} items={TABS.map((t) => ({ ...t, href: `/admin/financeiro?ver=${t.key}` }))} />
        {tab.key === "liquidados" && <PeriodFilter action="/admin/financeiro" from={period.from} to={period.to} today={today} hidden={{ ver: "liquidados" }} />}
        {rows.length === 0 ? (
          <EmptyState title={tab.key === "liquidados" ? "Nada liquidado no período." : "Nenhum lançamento em aberto."} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{tab.key === "liquidados" ? "Pago em" : "Vencimento"}</Th>
                <Th>Descrição</Th>
                <Th>Categoria</Th>
                <Th className="text-right">Valor</Th>
                <Th className="sr-only">Ações</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <TxRow key={t.id} t={t} today={today} settled={tab.key === "liquidados"} />
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

function sourceHref(t: Transaction) {
  if (!t.source_id) return null;
  if (t.source_type === "order" || t.source_type === "order_refund") return `/admin/pedidos/${t.source_id}`;
  if (t.source_type === "purchase_order") return `/admin/compras/${t.source_id}`;
  return null;
}

function TxRow({ t, today, settled }: { t: Transaction; today: string; settled: boolean }) {
  const state = dueState(t.due_date, today);
  const href = sourceHref(t);
  const fromOrder = t.source_type === "order" || t.source_type === "order_refund";
  return (
    <tr className="align-top">
      <Td className="whitespace-nowrap">
        {settled ? fmtDate(t.paid_at!) : fmtDate(t.due_date)}
        {!settled && state === "overdue" && <Badge tone="danger" className="ml-2">Vencido</Badge>}
        {!settled && state === "today" && <Badge tone="warning" className="ml-2">Hoje</Badge>}
      </Td>
      <Td>
        {fromOrder ? (
          <span>{t.description}</span>
        ) : (
          <Link href={`/admin/financeiro/${t.id}`} className="hover:underline">
            {t.description}
          </Link>
        )}
        <span className="block text-xs text-muted-foreground">
          {[t.customer?.name, t.supplier?.name].filter(Boolean).join(" · ")}
          {href && (
            <>
              {(t.customer || t.supplier) && " · "}
              <Link href={href} className="underline">
                {SOURCE_LABEL[t.source_type!]}
              </Link>
            </>
          )}
          {settled && t.payment_method && ` · ${PAYMENT_METHOD_LABEL[t.payment_method]}`}
        </span>
      </Td>
      <Td className="text-muted-foreground">{t.category.name}</Td>
      <Td className={`whitespace-nowrap text-right tabular-nums ${t.type === "expense" ? "text-danger" : "text-success"}`}>
        {t.type === "expense" ? "−" : "+"}
        {formatMoney(settled ? t.paid_amount : t.amount)}
      </Td>
      <Td className="text-right">
        {fromOrder ? (
          t.status === "open" && (
            <Link href={href!} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Receber no pedido
            </Link>
          )
        ) : settled ? (
          <StatusButton id={t.id} to="open" label="Desfazer" confirmText="Desfazer a liquidação? O lançamento volta para em aberto." />
        ) : (
          <div className="flex flex-col items-end gap-1">
            <SettleTransaction id={t.id} amount={t.amount} label={t.type === "income" ? "Receber" : "Pagar"} />
            <StatusButton id={t.id} to="canceled" label="Cancelar" confirmText="Cancelar este lançamento?" />
          </div>
        )}
      </Td>
    </tr>
  );
}
