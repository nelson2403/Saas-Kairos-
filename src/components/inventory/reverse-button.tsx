"use client";

import { useActionState, useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { reverseMovementAction } from "@/app/admin/movimentacoes/actions";

/** Estorno com motivo obrigatório. A chave de operação evita estorno duplicado em reenvio. */
export function ReverseButton({ movementId }: { movementId: string }) {
  const [open, setOpen] = useState(false);
  const [opId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(reverseMovementAction, null);

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Undo2 aria-hidden /> Estornar
      </Button>
    );
  }
  return (
    <form action={action} className="flex min-w-64 flex-col gap-2 text-left">
      <input type="hidden" name="op_id" value={opId} />
      <input type="hidden" name="movement_id" value={movementId} />
      <Input name="reason" placeholder="Motivo do estorno" required minLength={3} maxLength={300} autoFocus aria-label="Motivo do estorno" />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="danger" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Confirmar estorno
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancelar
        </Button>
      </div>
      {state && !state.ok && <FieldError message={state.error ?? Object.values(state.fieldErrors ?? {})[0]} />}
    </form>
  );
}
