"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { AddressFields, PhoneEmailFields } from "@/components/partners/contact-fields";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Select, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { formatDocument } from "@/lib/validations/document";
import type { Customer } from "@/modules/partners/service";
import { saveCustomerAction } from "./actions";

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export function CustomerForm({ customer, canEdit }: { customer: Customer | null; canEdit: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveCustomerAction.bind(null, customer?.id ?? null), null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <fieldset disabled={!canEdit || pending} className="contents">
        <Field label="Nome" htmlFor="name" error={errors.name} className="sm:col-span-2">
          <Input id="name" name="name" defaultValue={customer?.name} required maxLength={160} autoComplete="off" aria-invalid={!!errors.name} />
        </Field>
        <Field label="CPF ou CNPJ" htmlFor="document" error={errors.document} hint="Opcional. Peça só quando necessário (nota fiscal, cobrança).">
          <Input id="document" name="document" inputMode="numeric" defaultValue={formatDocument(customer?.document ?? null)} maxLength={18} autoComplete="off" />
        </Field>
        <Field label="Data de nascimento" htmlFor="birth_date" error={errors.birth_date} hint="Opcional.">
          <Input id="birth_date" name="birth_date" type="date" defaultValue={customer?.birth_date ?? ""} />
        </Field>
        <PhoneEmailFields phone={customer?.phone} email={customer?.email} errors={errors} />
        <AddressFields value={customer} errors={errors} />
        <Field label="Situação" htmlFor="status">
          <Select id="status" name="status" defaultValue={customer?.status ?? "active"}>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
          </Select>
        </Field>
        <Field label="Observações" htmlFor="notes" error={errors.notes} className="sm:col-span-2">
          <Textarea id="notes" name="notes" defaultValue={customer?.notes ?? ""} maxLength={2000} rows={3} placeholder="Preferências (aromas, tamanhos)…" />
        </Field>

        <fieldset className="rounded-md border border-border p-4 sm:col-span-2">
          <legend className="px-1 text-sm font-medium">Consentimentos (LGPD)</legend>
          <p className="mb-3 text-xs text-muted-foreground">
            Marque somente se o cliente autorizou de forma clara. Cada mudança fica registrada com data e responsável, e o cliente pode
            revogar a qualquer momento.
          </p>
          <Consent name="whatsapp_opt_in" checked={customer?.whatsapp_opt_in} at={customer?.whatsapp_opt_in_at} label="Aceita receber mensagens pelo WhatsApp (pedidos e novidades)" />
          <Consent name="marketing_opt_in" checked={customer?.marketing_opt_in} at={customer?.marketing_opt_in_at} label="Aceita receber promoções e novidades (marketing)" />
        </fieldset>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        {canEdit ? (
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {customer ? "Salvar alterações" : "Cadastrar cliente"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Seu perfil só consulta clientes.</p>
        )}
        {state?.ok && <p role="status" className="text-sm text-success">{state.message}</p>}
        {state && !state.ok && (state.error || Object.keys(errors).length > 0) && <FieldError message={state.error ?? "Revise os campos destacados."} />}
      </div>
    </form>
  );
}

function Consent({ name, label, checked, at }: { name: string; label: string; checked?: boolean; at?: string | null }) {
  return (
    <label className="mt-2 flex items-start gap-3 text-sm first-of-type:mt-0">
      <input type="checkbox" name={name} defaultChecked={checked ?? false} className="mt-0.5 size-4 accent-tinta" />
      <span>
        {label}
        {checked && at && <span className="block text-xs text-muted-foreground">Autorizado em {dateFormat.format(new Date(at))}</span>}
      </span>
    </label>
  );
}
