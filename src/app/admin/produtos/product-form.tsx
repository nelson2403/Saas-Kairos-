"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Select, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { DIMENSION_LABEL, formatMoney, marginPercent, parseDecimal, type Unit } from "@/modules/inventory/domain";
import type { Product } from "@/modules/inventory/service";
import { saveProductAction } from "./actions";

const toInput = (v: string | number | null | undefined) => (v == null ? "" : String(Number(v)).replace(".", ","));

export function ProductForm({
  product,
  categories,
  units,
  canEdit,
  unitLocked,
  hasRecipe = false,
}: {
  product: Product | null;
  categories: { id: string; path: string }[];
  units: Unit[];
  canEdit: boolean;
  unitLocked: boolean;
  hasRecipe?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    saveProductAction.bind(null, product?.id ?? null),
    null,
  );
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};
  const [price, setPrice] = useState(toInput(product?.sale_price));
  const [cost, setCost] = useState(toInput(product?.cost_price));
  const margin = marginPercent(parseDecimal(price), cost ? parseDecimal(cost) : null);

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <fieldset disabled={!canEdit || pending} className="contents">
        <Field label="Nome" htmlFor="name" error={errors.name} className="sm:col-span-2">
          <Input id="name" name="name" defaultValue={product?.name} required maxLength={160} aria-invalid={!!errors.name} />
        </Field>

        <Field label="SKU (código interno)" htmlFor="sku" error={errors.sku}>
          <Input id="sku" name="sku" defaultValue={product?.sku ?? ""} maxLength={60} aria-invalid={!!errors.sku} />
        </Field>
        <Field label="Código de barras" htmlFor="barcode" error={errors.barcode} hint="EAN/GTIN. Um leitor USB digita direto neste campo.">
          <Input id="barcode" name="barcode" defaultValue={product?.barcode ?? ""} inputMode="numeric" maxLength={48} aria-invalid={!!errors.barcode} />
        </Field>

        <Field label="Categoria" htmlFor="category_id" error={errors.category_id}>
          <Select id="category_id" name="category_id" defaultValue={product?.category_id ?? ""}>
            <option value="">Sem categoria</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.path}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Unidade de estoque"
          htmlFor="unit_id"
          error={errors.unit_id}
          hint={unitLocked ? "Não pode ser alterada: o produto já tem movimentações ou ficha técnica." : "Como o saldo é contado (ex.: un)."}
        >
          <Select
            id="unit_id"
            name="unit_id"
            defaultValue={product?.unit_id ?? units.find((u) => u.code === "un")?.id}
            disabled={unitLocked}
            required
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.code}) · {DIMENSION_LABEL[u.dimension]}
              </option>
            ))}
          </Select>
          {unitLocked && <input type="hidden" name="unit_id" value={product?.unit_id} />}
        </Field>

        <Field label="Preço de venda (R$)" htmlFor="sale_price" error={errors.sale_price}>
          <Input
            id="sale_price"
            name="sale_price"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0,00"
            required
            aria-invalid={!!errors.sale_price}
          />
        </Field>
        <Field
          label="Custo (R$)"
          htmlFor="cost_price"
          error={errors.cost_price}
          hint={
            margin === null
              ? hasRecipe
                ? "Atualizado automaticamente a cada produção concluída."
                : "Opcional. Com ficha técnica, passa a ser atualizado a cada produção."
              : `${hasRecipe ? "Última produção · " : ""}Margem: ${margin.toLocaleString("pt-BR")}% · lucro ${formatMoney(parseDecimal(price) - parseDecimal(cost))} por unidade`
          }
        >
          <Input
            id="cost_price"
            name="cost_price"
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="0,00"
            aria-invalid={!!errors.cost_price}
          />
        </Field>

        <Field label="Estoque mínimo" htmlFor="min_stock" error={errors.min_stock} hint="Abaixo disto o item aparece nos alertas.">
          <Input id="min_stock" name="min_stock" inputMode="decimal" defaultValue={toInput(product?.min_stock)} placeholder="0" />
        </Field>
        <Field label="Situação" htmlFor="status" error={errors.status}>
          <Select id="status" name="status" defaultValue={product?.status ?? "active"}>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo (não vende, continua no estoque)</option>
            <option value="archived">Arquivado (oculto e sem movimentação)</option>
          </Select>
        </Field>

        <Field label="Descrição" htmlFor="description" error={errors.description} className="sm:col-span-2">
          <Textarea id="description" name="description" defaultValue={product?.description ?? ""} maxLength={5000} rows={4} />
        </Field>

        <label className="flex items-start gap-3 text-sm sm:col-span-2">
          <input type="checkbox" name="show_in_store" defaultChecked={product?.show_in_store ?? false} className="mt-0.5 size-4 accent-tinta" />
          <span>
            Exibir na loja virtual
            <span className="block text-xs text-muted-foreground">Aparece na loja quando ativo e com a loja aberta (Configurações → Loja virtual).</span>
          </span>
        </label>
      </fieldset>

      {!product && canEdit && (
        <p className="text-sm text-muted-foreground sm:col-span-2">As fotos são adicionadas logo após cadastrar o produto.</p>
      )}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        {canEdit ? (
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {product ? "Salvar alterações" : "Cadastrar produto"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Somente proprietário, administrador ou gerente altera produtos.</p>
        )}
        {state?.ok && <p role="status" className="text-sm text-success">{state.message}</p>}
        {state && !state.ok && state.error && <FieldError message={state.error} />}
      </div>
    </form>
  );
}
