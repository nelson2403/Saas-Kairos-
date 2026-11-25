"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldError, Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { changePasswordAction } from "./actions";

export function PasswordForm({ forced }: { forced: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(changePasswordAction, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="Nova senha" htmlFor="password" hint="Pelo menos 10 caracteres." error={errors.password}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required aria-invalid={!!errors.password} />
      </Field>
      <Field label="Repita a nova senha" htmlFor="confirm" error={errors.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required aria-invalid={!!errors.confirm} />
      </Field>
      {state && !state.ok && state.error && <FieldError message={state.error} />}
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Salvar senha
        </Button>
        {!forced && (
          <Link href="/admin" className={buttonVariants({ variant: "outline" })}>
            Cancelar
          </Link>
        )}
      </div>
    </form>
  );
}
