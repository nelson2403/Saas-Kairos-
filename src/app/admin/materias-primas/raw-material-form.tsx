"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Select, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { DIMENSION_LABEL, type Unit } from "@/modules/inventory/domain";
import type { RawMaterial } from "@/modules/inventory/service";
import { saveRawMaterialAction } from "./actions";

const toInput = (v: string | number | null | undefined) => (v == null ? "" : String(Number(v)).replace(".", ","));

export function RawMaterialForm({
  material,
  units,
  canEdit,
  unitLocked,
}: {
  material: RawMaterial | null;
  units: Unit[];
  canEdit: boolean;
  unitLocked: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    saveRawMaterialAction.bind(null, material?.id ?? null),
    null,
  );
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};
  const [unitId, setUnitId] = useState(material?.unit_id ?? units.find((u) => u.code === "g")?.id ?? "");
  const dimension = units.find((u) => u.id === unitId)?.dimension;

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <fieldset disabled={!canEdit || pending} className="contents">
        <Field label="Nome" htmlFor="name" error={errors.name}>
          <Input id="name" name="name" defaultValue={material?.name} required maxLength={160} aria-invalid={!!errors.name} />
        </Field>
        <Field label="Código" htmlFor="code" error={errors.code}>
          <Input id="code" name="code" defaultValue={material?.code ?? ""} maxLength={60} />
        </Field>

        <Field
          label="Unidade de estoque"
          htmlFor="unit_id"
          error={errors.unit_id}
          hint={unitLocked ? "Não pode ser alterada: já há movimentações." : "Unidade em que o saldo é controlado (ex.: g, ml)."}
        >
          <Select id="unit_id" name="unit_id" value={unitId} onChange={(e) => setUnitId(e.target.value)} disabled={unitLocked} required>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.code}) · {DIMENSION_LABEL[u.dimension]}
              </option>
            ))}
          </Select>
          {unitLocked && <input type="hidden" name="unit_id" value={unitId} />}
        </Field>
        <Field
          label="Densidade (g/ml)"
          htmlFor="density"
          error={errors.density}
          hint={
            dimension === "mass" || dimension === "volume"
              ? "Opcional. Permite lançar em litros um item controlado em gramas (e vice-versa)."
              : "Só usada para itens de massa ou volume."
          }
        >
          <Input id="density" name="density" inputMode="decimal" defaultValue={toInput(material?.density)} placeholder="ex.: 0,92" />
        </Field>

        <Field label="Estoque mínimo" htmlFor="min_stock" error={errors.min_stock} hint="Na unidade de estoque. Abaixo disto aparece nos alertas.">
          <Input id="min_stock" name="min_stock" inputMode="decimal" defaultValue={toInput(material?.min_stock)} placeholder="0" />
        </Field>
        <Field label="Situação" htmlFor="status" error={errors.status}>
          <Select id="status" name="status" defaultValue={material?.status ?? "active"}>
            <option value="active">Ativa</option>
            <option value="inactive">Inativa</option>
            <option value="archived">Arquivada (oculta e sem movimentação)</option>
          </Select>
        </Field>

        <Field label="Observações" htmlFor="notes" error={errors.notes} className="sm:col-span-2">
          <Textarea id="notes" name="notes" defaultValue={material?.notes ?? ""} maxLength={2000} rows={3} />
        </Field>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        {canEdit ? (
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {material ? "Salvar alterações" : "Cadastrar matéria-prima"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Somente proprietário, administrador ou gerente altera cadastros.</p>
        )}
        {state?.ok && (
          <p role="status" className="text-sm text-success">
            {state.message}
          </p>
        )}
        {state && !state.ok && state.error && <FieldError message={state.error} />}
      </div>
    </form>
  );
}
