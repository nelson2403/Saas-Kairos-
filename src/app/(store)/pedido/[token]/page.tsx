import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CheckCircle2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatMoney, formatQuantity } from "@/modules/inventory/domain";
import { formatOrderNumber } from "@/modules/sales/domain";
import { getStoreSettings } from "@/modules/store/data";
import { DELIVERY_LABEL, STORE_ORDER_STATUS, whatsappLink } from "@/modules/store/domain";
import { getStoreOrder } from "@/modules/store/service";

export const metadata: Metadata = { title: "Seu pedido", robots: { index: false, follow: false } };

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export default function OrderStatusPage(props: PageProps<"/pedido/[token]">) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 md:px-6">
      <Suspense fallback={<div className="h-80 animate-pulse rounded-lg bg-muted" aria-busy="true" />}>
        <OrderStatus {...props} />
      </Suspense>
    </main>
  );
}

async function OrderStatus({ params, searchParams }: PageProps<"/pedido/[token]">) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const [order, settings] = await Promise.all([getStoreOrder(token), getStoreSettings()]);
  if (!order) notFound();
  const status = STORE_ORDER_STATUS[order.status] ?? { label: order.status, text: "" };
  const number = formatOrderNumber(order.number);
  const wa = whatsappLink(settings?.whatsapp, `Olá! Fiz o pedido ${number} na loja virtual.`);

  return (
    <div className="space-y-6">
      {sp.novo && (
        <div className="flex items-start gap-3 rounded-lg bg-success/10 p-4 text-success">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p>
            Pedido recebido! Guarde este endereço para acompanhar: ele é o seu comprovante.
          </p>
        </div>
      )}
      <div>
        <p className="text-sm uppercase tracking-[0.15em] text-muted-foreground">Pedido {number}</p>
        <h1 className="font-display text-4xl">{status.label}</h1>
        <p className="mt-2 text-muted-foreground">{status.text}</p>
      </div>

      {order.status === "pending" && settings && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-2 font-display text-2xl">Como pagar</h2>
          <p className="whitespace-pre-line text-sm">{settings.payment_instructions}</p>
          {order.reserved_until && <p className="mt-3 text-sm text-muted-foreground">Reserva válida até {dateTime.format(new Date(order.reserved_until))}.</p>}
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className={`${buttonVariants()} mt-4`}>
              Falar no WhatsApp
            </a>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border p-5">
        <ul className="space-y-2 text-sm">
          {order.items.map((i, idx) => (
            <li key={idx} className="flex justify-between gap-3">
              <span>
                {formatQuantity(i.quantity, i.unit === "un" ? undefined : i.unit)}× {i.name}
              </span>
              <span className="tabular-nums">{formatMoney(i.total)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
          {Number(order.shipping) > 0 && (
            <div className="flex justify-between">
              <dt>Entrega</dt>
              <dd className="tabular-nums">{formatMoney(order.shipping)}</dd>
            </div>
          )}
          <div className="flex justify-between text-lg">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatMoney(order.total)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-muted-foreground">
          {order.delivery_method ? DELIVERY_LABEL[order.delivery_method] : ""} · feito em {dateTime.format(new Date(order.created_at))}
        </p>
      </div>

      <Link href="/produtos" className="text-sm underline">
        Continuar comprando
      </Link>
    </div>
  );
}
