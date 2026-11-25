"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import type { ActionResult } from "@/lib/action-result";
import { BASE_UNIT, DIMENSION_LABEL, type Unit } from "@/modules/inventory/domain";
import { createUnitAction, saveStockSettingsAction } from "./actions";

export function StockSettingsForm({ allowNegative, canEdit }: { allowNegative: boolean; canEdit: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveStockSettingsAction, null);
  return (
    <form action={action} className="space-y-3">
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="allow_negative" defaultChecked={allowNegative} disabled={!canEdit} className="mt-0.5 size-4 accent-tinta" />
        <span>
          Permitir estoque negativo
          <span className="block text-xs text-muted-foreground">
            Desligado (recomendado): saídas maiores que o saldo são recusadas. Ligado: o saldo pode ficar negativo e
            aparece em vermelho até ser corrigido.
          </span>
        </span>
      </label>
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Salvar preferência
          </Button>
          {state?.ok && (
            <p role="status" className="text-sm text-success">
              {state.message}
            </p>
          )}
          {state && !state.ok && <FieldError message={state.error} />}
        </div>
      )}
    </form>
  );
}

export function UnitsManager({ units, canEdit }: { units: Unit[]; canEdit: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createUnitAction, null);
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <div className="space-y-5">
      <Table>
        <thead>
          <tr>
            <Th>Unidade</Th>
            <Th>Tipo</Th>
            <Th className="text-right">Equivale a</Th>
            <Th>Origem</Th>
          </tr>
        </thead>
        <tbody>
          {units.map((u) => (
            <tr key={u.id}>
              <Td>
                {u.name} <span className="text-muted-foreground">({u.code})</span>
              </Td>
              <Td>{DIMENSION_LABEL[u.dimension]}</Td>
              <Td className="text-right tabular-nums">
                {Number(u.factor_to_base).toLocaleString("pt-BR", { maximumFractionDigits: 6 })} {BASE_UNIT[u.dimension]}
              </Td>
              <Td className="text-muted-foreground">{u.company_id ? "Personalizada" : "Sistema"}</Td>
            </tr>
          ))}
        </tbody>
      </Table>

      {canEdit && (
        <form action={action} className="grid gap-3 sm:grid-cols-4">
          <Field label="Sigla" htmlFor="unit-code" error={errors.code}>
            <Input id="unit-code" name="code" placeholder="cx12" maxLength={12} required />
          </Field>
          <Field label="Nome" htmlFor="unit-name" error={errors.name}>
            <Input id="unit-name" name="name" placeholder="Caixa com 12" maxLength={60} required />
          </Field>
          <Field label="Tipo" htmlFor="unit-dimension" error={errors.dimension}>
            <Select id="unit-dimension" name="dimension" defaultValue="unit">
              {Object.entries(DIMENSION_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label} (base {BASE_UNIT[k as keyof typeof BASE_UNIT]})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Quantas unidades-base" htmlFor="unit-factor" error={errors.factor} hint="ex.: caixa com 12 → 12">
            <Input id="unit-factor" name="factor" inputMode="decimal" placeholder="12" required />
          </Field>
          <div className="flex items-center gap-3 sm:col-span-4">
            <Button type="submit" variant="secondary" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Adicionar unidade
            </Button>
            {state?.ok && (
              <p role="status" className="text-sm text-success">
                {state.message}
              </p>
            )}
            {state && !state.ok && state.error && <FieldError message={state.error} />}
          </div>
        </form>
      )}
    </div>
  );
}
