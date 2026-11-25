"use client";

import { useActionState, useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Select } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, todayBR } from "@/modules/sales/domain";
import { setTransactionStatusAction, settleTransactionAction } from "./actions";

const toInput = (v: string) => String(Number(v)).replace(".", ",");

/** Liquidar (pagar/receber) um lançamento em aberto. */
export function SettleTransaction({ id, amount, label }: { id: string; amount: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(settleTransactionAction, null);
  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <CheckCircle2 aria-hidden /> {label}
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2 text-left">
      <input type="hidden" name="id" value={id} />
      <div className="grid grid-cols-2 gap-2">
        <Input name="paid_at" type="date" defaultValue={todayBR()} max={todayBR()} aria-label="Data do pagamento" required />
        <Input name="amount" inputMode="decimal" defaultValue={toInput(amount)} aria-label="Valor pago" required />
      </div>
      <Select name="method" defaultValue="" aria-label="Forma de pagamento" required>
        <option value="" disabled>
          Forma de pagamento…
        </option>
        {PAYMENT_METHODS.map((m) => (
          <option key={m} value={m}>
            {PAYMENT_METHOD_LABEL[m]}
          </option>
        ))}
      </Select>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Confirmar
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Voltar
        </Button>
      </div>
      {state && !state.ok && <FieldError message={state.error ?? Object.values(state.fieldErrors ?? {})[0]} />}
    </form>
  );
}

/** Cancelar lançamento aberto ou desfazer liquidação. */
export function StatusButton({ id, to, label, confirmText }: { id: string; to: "open" | "canceled"; label: string; confirmText: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (!confirm(confirmText)) return;
          start(async () => {
            const r = await setTransactionStatusAction(id, to);
            setError(r.ok ? null : (r.error ?? "Não foi possível."));
          });
        }}
      >
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {label}
      </Button>
      <FieldError message={error ?? undefined} />
    </span>
  );
}
