import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { requireMembership } from "@/lib/auth/dal";
import { canEditCustomers, canHandlePrivacy, getCustomer } from "@/modules/partners/service";
import { formatMoney } from "@/modules/inventory/domain";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, formatOrderNumber } from "@/modules/sales/domain";
import { canSell, listOrders } from "@/modules/sales/service";
import { CustomerForm } from "../customer-form";
import { AnonymizeCustomer } from "./privacy-actions";

export const metadata: Metadata = { title: "Cliente" };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const CHANNEL = { marketing: "Marketing", whatsapp: "WhatsApp" } as const;
const SOURCE: Record<string, string> = { painel: "painel", loja: "loja virtual", anonimizacao: "anonimização" };

export default function CustomerPage(props: PageProps<"/admin/clientes/[id]">) {
  return (
    <Suspense fallback={<SectionSkeleton lines={4} />}>
      <Detail {...props} />
    </Suspense>
  );
}

async function Detail({ params, searchParams }: PageProps<"/admin/clientes/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [{ role }, data, orders] = await Promise.all([requireMembership(), getCustomer(id), listOrders({ customerId: id })]);
  if (!data) notFound();
  const { customer, consents, people } = data;
  const anonymized = !!customer.anonymized_at;

  return (
    <>
      <PageHeader title={customer.name} description={anonymized ? `Anonimizado em ${dateFormat.format(new Date(customer.anonymized_at!))}` : undefined}>
        <Link href="/admin/clientes" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft aria-hidden /> Clientes
        </Link>
      </PageHeader>
      {sp.criado && (
        <p role="status" className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">
          Cliente cadastrado.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle className="mb-4">Cadastro</CardTitle>
          {anonymized ? (
            <p className="text-sm text-muted-foreground">Os dados pessoais deste cliente foram removidos a pedido do titular e não podem ser editados.</p>
          ) : (
            <CustomerForm customer={customer} canEdit={canEditCustomers(role)} />
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardTitle className="mb-3">Histórico de consentimentos</CardTitle>
            {consents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma autorização registrada.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {consents.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={c.granted ? "success" : "neutral"}>{c.granted ? "Autorizou" : "Revogou"}</Badge>
                    <span>{CHANNEL[c.channel]}</span>
                    <span className="w-full text-xs text-muted-foreground">
                      {dateFormat.format(new Date(c.created_at))} · {SOURCE[c.source] ?? c.source}
                      {c.recorded_by && people[c.recorded_by] ? ` · por ${people[c.recorded_by]}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <CardTitle>Pedidos</CardTitle>
              {canSell(role) && !anonymized && (
                <Link href={`/admin/pedidos/novo?cliente=${customer.id}`} className="text-sm text-muted-foreground hover:text-foreground">
                  Novo pedido
                </Link>
              )}
            </div>
            {orders.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum pedido ainda.</p>
            ) : (
              <>
                <p className="mb-2 text-sm">
                  {orders.rows.filter((o) => o.status === "paid" || o.status === "delivered").length} compras ·{" "}
                  {formatMoney(orders.rows.filter((o) => o.status === "paid" || o.status === "delivered").reduce((s, o) => s + Number(o.total), 0))}
                </p>
                <ul className="space-y-1 text-sm">
                  {orders.rows.slice(0, 10).map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-2">
                      <Link href={`/admin/pedidos/${o.id}`} className="hover:underline">
                        {formatOrderNumber(o.number)} · {formatMoney(o.total)}
                      </Link>
                      <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          {canHandlePrivacy(role) && (
            <Card>
              <CardTitle className="mb-2">Privacidade (LGPD)</CardTitle>
              <p className="mb-3 text-sm text-muted-foreground">Atendimento a pedidos do titular. Cada exportação fica registrada na auditoria.</p>
              <div className="flex flex-col items-start gap-3">
                <a href={`/admin/clientes/${customer.id}/exportar`} className={buttonVariants({ variant: "outline" })} download>
                  <Download aria-hidden /> Exportar dados (JSON)
                </a>
                {!anonymized && <AnonymizeCustomer customerId={customer.id} />}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
