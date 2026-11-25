"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Select } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { createCategoryAction } from "../actions";

export function CategoryForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createCategoryAction, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="space-y-3">
      <Field label="Nome" htmlFor="name" error={errors.name}>
        <Input id="name" name="name" required maxLength={60} placeholder="Ex.: Embalagens" />
      </Field>
      <Field label="Tipo" htmlFor="type">
        <Select id="type" name="type" defaultValue="expense">
          <option value="expense">Despesa</option>
          <option value="income">Receita</option>
        </Select>
      </Field>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Criar categoria
      </Button>
      {state?.ok && <p role="status" className="text-sm text-success">{state.message}</p>}
      {state && !state.ok && state.error && <FieldError message={state.error} />}
    </form>
  );
}
