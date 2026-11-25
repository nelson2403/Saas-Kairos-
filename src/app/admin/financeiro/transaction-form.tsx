"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Select, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import type { TransactionType } from "@/modules/finance/domain";
import type { Category, Transaction } from "@/modules/finance/service";
import { saveTransactionAction } from "./actions";

const toInput = (v: string | null | undefined) => (v == null ? "" : String(Number(v)).replace(".", ","));

export function TransactionForm({
  transaction,
  categories,
  suppliers,
  defaultType = "expense",
}: {
  transaction: Transaction | null;
  categories: Category[];
  suppliers: { id: string; name: string; trade_name: string | null }[];
  defaultType?: TransactionType;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveTransactionAction.bind(null, transaction?.id ?? null), null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const [type, setType] = useState<TransactionType>(transaction?.type ?? defaultType);
  const fromDocument = !!transaction?.source_type;
  const options = categories.filter((c) => c.type === type && (c.active || c.id === transaction?.category.id));

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <fieldset disabled={pending} className="contents">
        <Field label="Tipo" htmlFor="type">
          <Select id="type" name="type" value={type} onChange={(e) => setType(e.target.value as TransactionType)} disabled={fromDocument}>
            <option value="expense">Despesa (a pagar)</option>
            <option value="income">Receita (a receber)</option>
          </Select>
          {fromDocument && <input type="hidden" name="type" value={type} />}
        </Field>
        <Field label="Categoria" htmlFor="category_id" error={errors.category_id}>
          <Select id="category_id" name="category_id" defaultValue={transaction?.category.id ?? ""} key={type} required>
            <option value="">Selecione…</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Descrição" htmlFor="description" error={errors.description} className="sm:col-span-2">
          <Input id="description" name="description" defaultValue={transaction?.description} required maxLength={160} placeholder="Ex.: Aluguel de dezembro" />
        </Field>
        <Field label="Valor (R$)" htmlFor="amount" error={errors.amount} hint={fromDocument ? "Definido pelo documento de origem." : undefined}>
          <Input id="amount" name="amount" inputMode="decimal" defaultValue={toInput(transaction?.amount)} required readOnly={fromDocument} />
        </Field>
        <Field label="Vencimento" htmlFor="due_date" error={errors.due_date}>
          <Input id="due_date" name="due_date" type="date" defaultValue={transaction?.due_date} required />
        </Field>
        <Field label="Competência" htmlFor="competence_date" error={errors.competence_date} hint="Mês a que a despesa/receita se refere. Padrão: o vencimento.">
          <Input id="competence_date" name="competence_date" type="date" defaultValue={transaction?.competence_date} />
        </Field>
        {type === "expense" && (
          <Field label="Fornecedor (opcional)" htmlFor="supplier_id">
            <Select id="supplier_id" name="supplier_id" defaultValue={transaction?.supplier?.id ?? ""} disabled={fromDocument}>
              <option value="">—</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.trade_name || s.name}
                </option>
              ))}
            </Select>
            {fromDocument && <input type="hidden" name="supplier_id" value={transaction?.supplier?.id ?? ""} />}
          </Field>
        )}
        <Field label="Observações" htmlFor="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" defaultValue={transaction?.notes ?? ""} maxLength={2000} rows={2} />
        </Field>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {transaction ? "Salvar alterações" : "Criar lançamento"}
        </Button>
        {state?.ok && <p role="status" className="text-sm text-success">{state.message}</p>}
        {state && !state.ok && (state.error || Object.keys(errors).length > 0) && <FieldError message={state.error ?? "Revise os campos destacados."} />}
      </div>
    </form>
  );
}
