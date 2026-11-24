"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import type { ActionResult } from "@/modules/company/service";
import { createCompanyAction } from "./actions";

export function OnboardingForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createCompanyAction, null);
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Nome da empresa</Label>
        <Input id="name" name="name" required maxLength={120} defaultValue="Kairós" aria-invalid={Boolean(errors.name)} />
        <FieldError message={errors.name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="document">CNPJ ou CPF (opcional)</Label>
        <Input id="document" name="document" inputMode="numeric" aria-invalid={Boolean(errors.document)} />
        <FieldError message={errors.document} />
      </div>
      {state && !state.ok && <FieldError message={state.error} />}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Criar empresa
      </Button>
    </form>
  );
}
