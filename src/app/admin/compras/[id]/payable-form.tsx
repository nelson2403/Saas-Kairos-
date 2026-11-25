"use client";

import { useActionState, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { createPurchasePayableAction } from "@/app/admin/financeiro/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";

const toInput = (n: number) => n.toFixed(2).replace(".", ",");

/** Lança uma conta a pagar (ou parcela) do pedido de compra no financeiro. */
export function PayableForm({ orderId, remaining }: { orderId: string; remaining: number }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createPurchasePayableAction, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={remaining <= 0}>
        <Plus aria-hidden /> Lançar conta a pagar
      </Button>
    );
  }
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="order_id" value={orderId} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Valor (R$)" htmlFor="payable-amount" error={errors.amount}>
          <Input id="payable-amount" name="amount" inputMode="decimal" defaultValue={toInput(remaining)} required />
        </Field>
        <Field label="Vencimento" htmlFor="payable-due" error={errors.due_date}>
          <Input id="payable-due" name="due_date" type="date" required />
        </Field>
      </div>
      <Field label="Descrição (opcional)" htmlFor="payable-desc">
        <Input id="payable-desc" name="description" maxLength={160} placeholder="Ex.: parcela 1/2" />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Lançar
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Fechar
        </Button>
      </div>
      {state?.ok && <p role="status" className="text-sm text-success">{state.message}</p>}
      {state && !state.ok && state.error && <FieldError message={state.error} />}
    </form>
  );
}
