"use client";

import { useActionState, useState } from "react";
import { Loader2, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { anonymizeCustomerAction } from "../actions";

/** Anonimização irreversível, com motivo e confirmação digitada. */
export function AnonymizeCustomer({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(anonymizeCustomerAction, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ShieldOff aria-hidden /> Anonimizar dados
      </Button>
    );
  }
  return (
    <form action={action} className="space-y-3 rounded-md border border-danger/40 p-4">
      <p className="text-sm">
        Remove nome, documento, contatos, endereço e observações de forma <strong>irreversível</strong> e revoga os consentimentos. O
        registro continua só para o histórico de vendas, como “Cliente anonimizado”.
      </p>
      <input type="hidden" name="customer_id" value={customerId} />
      <Field label="Motivo" htmlFor="reason" error={errors.reason}>
        <Input id="reason" name="reason" required minLength={5} maxLength={300} placeholder="Ex.: solicitação do titular por e-mail em 10/12" />
      </Field>
      <Field label="Digite ANONIMIZAR para confirmar" htmlFor="confirm" error={errors.confirm}>
        <Input id="confirm" name="confirm" required autoComplete="off" />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Anonimizar
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Voltar
        </Button>
      </div>
      {state && !state.ok && state.error && <FieldError message={state.error} />}
    </form>
  );
}
