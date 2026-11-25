"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Select, Textarea } from "@/components/ui/input";
import {
  compatibleUnits,
  formatCost,
  formatMoney,
  formatQuantity,
  marginPercent,
  parseDecimal,
  type Unit,
} from "@/modules/inventory/domain";
import { estimateRecipeCost, type RecipeLine } from "@/modules/production/domain";
import type { MaterialInfo } from "@/modules/production/service";
import { deactivateRecipeAction, saveRecipeAction } from "../../actions";

type Row = { key: string; materialId: string; quantity: string; unitId: string };

const toInput = (v: string | number) => String(Number(v)).replace(".", ",");

export function RecipeEditor({
  product,
  active,
  materials,
  units,
  canEdit,
}: {
  product: { id: string; name: string; salePrice: number; unitCode: string };
  active: {
    yield_quantity: string;
    loss_percent: string;
    notes: string | null;
    items: { raw_material_id: string; quantity: string; unit_id: string }[];
  } | null;
  materials: MaterialInfo[];
  units: Unit[];
  canEdit: boolean;
}) {
  const [yieldQty, setYieldQty] = useState(active ? toInput(active.yield_quantity) : "1");
  const [loss, setLoss] = useState(active ? toInput(active.loss_percent) : "0");
  const [notes, setNotes] = useState(active?.notes ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    active
      ? active.items.map((i) => ({ key: crypto.randomUUID(), materialId: i.raw_material_id, quantity: toInput(i.quantity), unitId: i.unit_id }))
      : [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const unitsById = new Map(units.map((u) => [u.id, u]));
  const materialsById = new Map(materials.map((m) => [m.id, m]));

  const y = parseDecimal(yieldQty);
  const l = loss.trim() ? parseDecimal(loss) : 0;
  const lines: (RecipeLine & { key: string })[] = rows.flatMap((r) => {
    const m = materialsById.get(r.materialId);
    const q = parseDecimal(r.quantity);
    const unit = unitsById.get(r.unitId);
    const stockUnit = m ? unitsById.get(m.unitId) : undefined;
    if (!m || !unit || !stockUnit || !(q > 0)) return [];
    return [{ key: r.key, rawMaterialId: m.id, quantity: q, unit, stockUnit, density: m.density, cost: m.cost }];
  });
  const estimate = y > 0 && l >= 0 && l < 100 ? estimateRecipeCost(lines, y, l) : null;
  const incomplete = !!estimate && (estimate.missingCost.length > 0 || estimate.invalid.length > 0);
  const margin = estimate && !incomplete && lines.length ? marginPercent(product.salePrice, estimate.unitCost) : null;

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function addRow() {
    setRows((rs) => [...rs, { key: crypto.randomUUID(), materialId: "", quantity: "", unitId: "" }]);
  }

  function save() {
    const errs: Record<string, string> = {};
    if (!(y > 0)) errs.yield_quantity = "Informe quanto a receita rende.";
    if (Number.isNaN(l) || l < 0 || l >= 100) errs.loss_percent = "Entre 0 e 99,9.";
    if (!rows.length) errs.items = "Inclua ao menos uma matéria-prima.";
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.materialId) errs[`row:${r.key}`] = "Selecione a matéria-prima.";
      else if (seen.has(r.materialId)) errs[`row:${r.key}`] = "Matéria-prima repetida.";
      else if (!(parseDecimal(r.quantity) > 0)) errs[`row:${r.key}`] = "Informe a quantidade.";
      seen.add(r.materialId);
    }
    if (estimate?.invalid.length) errs.items = "Há unidades que não convertem para a unidade de estoque do insumo.";
    setErrors(errs);
    setFeedback(null);
    if (Object.keys(errs).length) return;

    start(async () => {
      const result = await saveRecipeAction({
        product_id: product.id,
        yield_quantity: yieldQty,
        loss_percent: loss || "0",
        notes,
        items: rows.map((r) => ({
          raw_material_id: r.materialId,
          quantity: r.quantity,
          unit_id: r.unitId || materialsById.get(r.materialId)?.unitId,
        })),
      });
      if (result.ok) setFeedback({ ok: true, text: result.message ?? "Ficha técnica salva." });
      else {
        setErrors(result.fieldErrors ?? {});
        setFeedback({ ok: false, text: result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? "Revise os campos." });
      }
    });
  }

  function deactivate() {
    if (!confirm(`Desativar a ficha técnica de ${product.name}? Ele não poderá ser produzido até salvar uma nova.`)) return;
    start(async () => {
      const result = await deactivateRecipeAction(product.id);
      setFeedback({ ok: result.ok, text: result.ok ? (result.message ?? "") : (result.error ?? "Não foi possível desativar.") });
    });
  }

  if (!materials.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma matéria-prima cadastrada. Cadastre os insumos em{" "}
        <Link href="/admin/materias-primas/nova" className="underline">
          Matérias-primas
        </Link>{" "}
        para montar a ficha técnica.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <fieldset disabled={!canEdit || pending} className="grid gap-4 sm:grid-cols-3">
        <Field
          label={`Rendimento (${product.unitCode})`}
          htmlFor="yield_quantity"
          error={errors.yield_quantity}
          hint="Quantas unidades do produto a receita abaixo produz."
        >
          <Input id="yield_quantity" inputMode="decimal" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} />
        </Field>
        <Field label="Perda prevista (%)" htmlFor="loss_percent" error={errors.loss_percent} hint="Acrescida ao consumo de cada insumo (sobras, respingos).">
          <Input id="loss_percent" inputMode="decimal" value={loss} onChange={(e) => setLoss(e.target.value)} />
        </Field>
        <Field label="Observações" htmlFor="notes" className="sm:col-span-3">
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} placeholder="Modo de preparo, temperatura, tempo de cura…" />
        </Field>
      </fieldset>

      <div>
        <h3 className="mb-2 text-sm font-medium">Matérias-primas por rendimento</h3>
        {rows.length === 0 && <p className="mb-2 text-sm text-muted-foreground">Nenhum insumo ainda.</p>}
        <ul className="space-y-3">
          {rows.map((r) => {
            const m = materialsById.get(r.materialId);
            const stockUnit = m ? unitsById.get(m.unitId) : undefined;
            const options = m && stockUnit ? compatibleUnits(units, stockUnit, m.density) : [];
            const unitId = r.unitId || m?.unitId || "";
            const line = estimate?.lines.find((x) => x.rawMaterialId === r.materialId);
            const invalid = estimate?.invalid.includes(r.materialId);
            return (
              <li key={r.key} className="rounded-md border border-border p-3">
                <fieldset disabled={!canEdit || pending} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
                  <Field label="Matéria-prima" htmlFor={`m-${r.key}`}>
                    <Select id={`m-${r.key}`} value={r.materialId} onChange={(e) => update(r.key, { materialId: e.target.value, unitId: "" })}>
                      <option value="">Selecione…</option>
                      {materials.map((mat) => (
                        <option key={mat.id} value={mat.id}>
                          {mat.name}
                          {mat.code ? ` · ${mat.code}` : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Quantidade" htmlFor={`q-${r.key}`}>
                    <Input id={`q-${r.key}`} inputMode="decimal" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} />
                  </Field>
                  <Field label="Unidade" htmlFor={`u-${r.key}`}>
                    <Select id={`u-${r.key}`} value={unitId} onChange={(e) => update(r.key, { unitId: e.target.value })} disabled={!m}>
                      {options.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.code}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {canEdit && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Remover insumo">
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </fieldset>
                <p className="mt-2 text-xs text-muted-foreground">
                  {invalid
                    ? "Unidade não converte para a unidade de estoque deste insumo."
                    : line && stockUnit
                      ? `Consumo com perda: ${formatQuantity(line.stockQuantity, stockUnit.code)} · ${
                          line.cost == null ? "sem custo cadastrado (dê entrada com custo)" : `${formatCost(line.cost)}/${stockUnit.code} = ${formatMoney(line.total)}`
                        }`
                      : null}
                </p>
                <FieldError message={errors[`row:${r.key}`]} />
              </li>
            );
          })}
        </ul>
        {canEdit && (
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={addRow} disabled={pending}>
            <Plus aria-hidden /> Adicionar matéria-prima
          </Button>
        )}
        <FieldError message={errors.items} />
      </div>

      {estimate && lines.length > 0 && (
        <dl className="grid gap-3 rounded-md bg-muted/50 p-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Custo da receita</dt>
            <dd className="text-lg tabular-nums">{formatMoney(estimate.batchCost)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Custo por {product.unitCode}</dt>
            <dd className="text-lg tabular-nums">{formatCost(estimate.unitCost)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Margem sobre {formatMoney(product.salePrice)}</dt>
            <dd className="text-lg tabular-nums">{margin == null ? "—" : `${margin.toLocaleString("pt-BR")}%`}</dd>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-3">
            {incomplete
              ? "Estimativa incompleta: algum insumo não tem custo. Registre uma entrada com custo em Movimentações."
              : "Estimativa com o custo médio atual dos insumos. O custo real é calculado ao concluir cada ordem de produção."}
          </p>
        </dl>
      )}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={save} disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {active ? "Salvar nova versão" : "Salvar ficha técnica"}
          </Button>
          {active && (
            <Button type="button" variant="ghost" onClick={deactivate} disabled={pending}>
              Desativar ficha
            </Button>
          )}
          {feedback && (
            <p role={feedback.ok ? "status" : "alert"} className={`text-sm ${feedback.ok ? "text-success" : "text-danger"}`}>
              {feedback.text}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Somente proprietário, administrador ou gerente altera fichas técnicas.</p>
      )}
    </div>
  );
}
