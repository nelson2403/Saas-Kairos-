"use client";

import { useActionState, useState } from "react";
import { Ban, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { cancelOrderAction, reverseOrderAction } from "../actions";

/** Cancelar ordem em aberto (não mexe no estoque). */
export function CancelOrder({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(cancelOrderAction, null);
  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Ban aria-hidden /> Cancelar ordem
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <input type="hidden" name="order_id" value={orderId} />
      <Input name="reason" placeholder="Motivo (opcional)" maxLength={300} autoFocus aria-label="Motivo do cancelamento" className="sm:max-w-xs" />
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Confirmar cancelamento
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Voltar
        </Button>
      </div>
      {state && !state.ok && <FieldError message={state.error ?? Object.values(state.fieldErrors ?? {})[0]} />}
    </form>
  );
}

/** Estornar ordem concluída: devolve os insumos e retira o produto (uma única vez). */
export function ReverseOrder({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [opId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(reverseOrderAction, null);
  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Undo2 aria-hidden /> Estornar produção
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Devolve as matérias-primas ao estoque e retira o produto produzido. Só é possível se o produto ainda estiver em estoque.
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
