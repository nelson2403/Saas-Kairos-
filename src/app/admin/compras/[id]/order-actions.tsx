"use client";

import { useActionState, useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { reverseReceiptAction, setPurchaseStatusAction } from "../actions";

const LABEL = {
  ordered: { button: "Marcar como enviado", confirm: "Confirmar envio", variant: "outline" as const, reason: false },
  canceled: { button: "Cancelar pedido", confirm: "Confirmar cancelamento", variant: "ghost" as const, reason: true },
  closed: { button: "Encerrar saldo pendente", confirm: "Confirmar encerramento", variant: "outline" as const, reason: true },
};

/** Muda a situação do pedido (enviado, cancelado, encerrado) com confirmação. */
export function StatusAction({ orderId, status }: { orderId: string; status: keyof typeof LABEL }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(setPurchaseStatusAction, null);
  const l = LABEL[status];
  if (!open) {
    return (
      <Button variant={l.variant} onClick={() => setOpen(true)}>
        {l.button}
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="status" value={status} />
      {l.reason && <Input name="reason" placeholder="Motivo (opcional)" maxLength={300} aria-label="Motivo" className="sm:max-w-xs" autoFocus />}
      <div className="flex gap-2">
        <Button type="submit" variant={status === "canceled" ? "danger" : "primary"} disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {l.confirm}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Voltar
        </Button>
      </div>
      {state && !state.ok && <FieldError message={state.error ?? Object.values(state.fieldErrors ?? {})[0]} />}
    </form>
  );
}

/** Estorno de um recebimento: retira do estoque o que entrou (uma vez). */
export function ReverseReceipt({ receiptId }: { receiptId: string }) {
  const [open, setOpen] = useState(false);
  const [opId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(reverseReceiptAction, null);
  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Undo2 aria-hidden /> Estornar
      </Button>
    );
  }
  return (
    <form action={action} className="mt-2 flex flex-col gap-2 sm:flex-row">
      <input type="hidden" name="op_id" value={opId} />
      <input type="hidden" name="receipt_id" value={receiptId} />
      <Input name="reason" placeholder="Motivo do estorno" required minLength={3} maxLength={300} autoFocus aria-label="Motivo do estorno" className="sm:max-w-sm" />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="danger" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Confirmar estorno
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Voltar
        </Button>
      </div>
      {state && !state.ok && <FieldError message={state.error ?? Object.values(state.fieldErrors ?? {})[0]} />}
    </form>
  );
}
