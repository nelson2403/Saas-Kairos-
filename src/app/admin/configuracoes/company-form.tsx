"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { formatDocument } from "@/lib/validations/document";
import type { ActionResult } from "@/modules/company/service";
import { saveCompany } from "./actions";

type Company = {
  name: string;
  legal_name: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
};

export function CompanyForm({ company, canEdit }: { company: Company; canEdit: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveCompany, null);
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};

  const field = (name: keyof Company, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        defaultValue={name === "document" ? formatDocument(company.document) : company[name] ?? ""}
        disabled={!canEdit}
        aria-invalid={Boolean(errors[name])}
        {...props}
      />
      <FieldError message={errors[name]} />
    </div>
  );

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      {field("name", "Nome da empresa", { required: true, maxLength: 120 })}
      {field("legal_name", "Razão social", { maxLength: 200 })}
      {field("document", "CNPJ ou CPF", { inputMode: "numeric" })}
      {field("email", "E-mail", { type: "email", inputMode: "email" })}
      {field("phone", "Telefone", { type: "tel", inputMode: "tel", maxLength: 30 })}
      <div className="flex items-center gap-3 sm:col-span-2">
        {canEdit ? (
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Salvar
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Somente proprietário ou administrador pode alterar estes dados.</p>
        )}
        {state?.ok && <p role="status" className="text-sm text-success">{state.message}</p>}
        {state && !state.ok && state.error && <FieldError message={state.error} />}
      </div>
    </form>
  );
}
