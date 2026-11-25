"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { AddressFields, PhoneEmailFields } from "@/components/partners/contact-fields";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Select, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { formatDocument } from "@/lib/validations/document";
import type { Supplier } from "@/modules/partners/service";
import { saveSupplierAction } from "./actions";

export function SupplierForm({ supplier, canEdit }: { supplier: Supplier | null; canEdit: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveSupplierAction.bind(null, supplier?.id ?? null), null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <fieldset disabled={!canEdit || pending} className="contents">
        <Field label="Razão social ou nome" htmlFor="name" error={errors.name}>
          <Input id="name" name="name" defaultValue={supplier?.name} required maxLength={160} aria-invalid={!!errors.name} />
        </Field>
        <Field label="Nome fantasia" htmlFor="trade_name" error={errors.trade_name}>
          <Input id="trade_name" name="trade_name" defaultValue={supplier?.trade_name ?? ""} maxLength={160} />
        </Field>
        <Field label="CNPJ ou CPF" htmlFor="document" error={errors.document}>
          <Input id="document" name="document" inputMode="numeric" defaultValue={formatDocument(supplier?.document ?? null)} maxLength={18} />
        </Field>
        <Field label="Pessoa de contato" htmlFor="contact_name" error={errors.contact_name}>
          <Input id="contact_name" name="contact_name" defaultValue={supplier?.contact_name ?? ""} maxLength={120} />
        </Field>
        <PhoneEmailFields phone={supplier?.phone} email={supplier?.email} errors={errors} />
        <AddressFields value={supplier} errors={errors} />
        <Field label="Situação" htmlFor="status">
          <Select id="status" name="status" defaultValue={supplier?.status ?? "active"}>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo (não aparece em novos pedidos)</option>
          </Select>
        </Field>
        <Field label="Observações" htmlFor="notes" error={errors.notes} className="sm:col-span-2">
          <Textarea id="notes" name="notes" defaultValue={supplier?.notes ?? ""} maxLength={2000} rows={3} placeholder="Prazo de entrega, pedido mínimo, condições…" />
        </Field>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        {canEdit ? (
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {supplier ? "Salvar alterações" : "Cadastrar fornecedor"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Somente proprietário, administrador ou gerente altera fornecedores.</p>
        )}
        {state?.ok && <p role="status" className="text-sm text-success">{state.message}</p>}
        {state && !state.ok && (state.error || Object.keys(errors).length > 0) && <FieldError message={state.error ?? "Revise os campos destacados."} />}
      </div>
    </form>
  );
}
