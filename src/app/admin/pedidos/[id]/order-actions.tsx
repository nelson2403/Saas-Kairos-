"use client";

import { useActionState, useState, useTransition } from "react";
import { Ban, CheckCircle2, Loader2, Truck, Undo2 } from "lucide-react";
import { useOffline } from "next/offline";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Select } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, todayBR } from "@/modules/sales/domain";
import { cancelOrderAction, markDeliveredAction, payOrderAction, refundOrderAction } from "../actions";

/** Registrar pagamento: efetiva a venda no servidor (baixa o estoque). */
export function PayOrder({ orderId, total }: { orderId: string; total: string }) {
  const isOffline = useOffline();
  const [opId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(payOrderAction, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="op_id" value={opId} />
      <input type="hidden" name="order_id" value={orderId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Forma de pagamento" htmlFor="method" error={errors.method}>
          <Select id="method" name="method" required defaultValue="">
            <option value="" disabled>
              Selecione…
            </option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABEL[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Data do pagamento" htmlFor="paid_at" error={errors.paid_at}>
          <Input id="paid_at" name="paid_at" type="date" defaultValue={todayBR()} max={todayBR()} />
        </Field>
      </div>
      <Button type="submit" disabled={pending || isOffline}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCircle2 aria-hidden />}
        Confirmar recebimento de {total}
      </Button>
      {isOffline && <p className="text-sm text-warning">Sem conexão: o pagamento só é confirmado pelo servidor.</p>}
      {state && !state.ok && state.error && <FieldError message={state.error} />}
    </form>
  );
}

export function CancelOrder({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(cancelOrderAction, null);
  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Ban aria-hidden /> Cancelar pedido
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <input type="hidden" name="order_id" value={orderId} />
      <Input name="reason" placeholder="Motivo (opcional)" maxLength={300} aria-label="Motivo do cancelamento" className="sm:max-w-xs" autoFocus />
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Confirmar cancelamento
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Voltar
        </Button>
      </div>
      {state && !state.ok && <FieldError message={state.error} />}
    </form>
  );
}

export function DeliverOrder({ orderId }: { orderId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await markDeliveredAction(orderId);
            setError(r.ok ? null : (r.error ?? "Não foi possível."));
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Truck aria-hidden />}
        Marcar como entregue
      </Button>
      <FieldError message={error ?? undefined} />
    </div>
  );
}

export function RefundOrder({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [opId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(refundOrderAction, null);
  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Undo2 aria-hidden /> Estornar venda
      </Button>
    );
  }
  return (
    <form action={action} className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Devolve os produtos ao estoque, marca o pagamento como estornado e lança a saída do valor no caixa. Não pode ser desfeito.
      </p>
      <input type="hidden" name="op_id" value={opId} />
      <input type="hidden" name="order_id" value={orderId} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input name="reason" placeholder="Motivo do estorno" required minLength={3} maxLength={300} autoFocus aria-label="Motivo do estorno" className="sm:max-w-sm" />
        <div className="flex gap-2">
          <Button type="submit" variant="danger" disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Confirmar estorno
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Voltar
          </Button>
        </div>
      </div>
      {state && !state.ok && <FieldError message={state.error ?? Object.values(state.fieldErrors ?? {})[0]} />}
    </form>
  );
}
