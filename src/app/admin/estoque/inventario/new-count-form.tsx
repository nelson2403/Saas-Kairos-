"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Select } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { createCountAction } from "./actions";

export function NewCountForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createCountAction, null);
  return (
    <form action={action} className="space-y-4">
      <Field label="O que contar" htmlFor="scope">
        <Select id="scope" name="scope" defaultValue="all">
          <option value="all">Produtos e matérias-primas</option>
          <option value="products">Somente produtos</option>
          <option value="raw_materials">Somente matérias-primas</option>
        </Select>
      </Field>
      <Field label="Observações" htmlFor="notes">
        <Input id="notes" name="notes" maxLength={2000} placeholder="ex.: inventário mensal" />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Abrir contagem
      </Button>
      {state && !state.ok && <FieldError message={state.error} />}
    </form>
  );
}
