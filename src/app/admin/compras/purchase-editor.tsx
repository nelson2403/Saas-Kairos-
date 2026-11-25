"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useOffline } from "next/offline";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Select, Textarea } from "@/components/ui/input";
import { compatibleUnits, formatMoney, parseDecimal, type Unit } from "@/modules/inventory/domain";
import type { MovableItem } from "@/modules/inventory/service";
import { lineTotal } from "@/modules/purchasing/domain";
import { savePurchaseOrderAction } from "./actions";

type Row = { key: string; item: string; quantity: string; unitId: string; unitPrice: string };

export type PurchaseEditorInitial = {
  orderId: string;
  supplierId: string;
  expectedDate: string | null;
  notes: string | null;
  items: { item: string; quantity: string; unitId: string; unitPrice: string }[];
};

const toInput = (v: string | number) => String(Number(v)).replace(".", ",");

export function PurchaseEditor({
  suppliers,
  items,
  units,
  initial,
  initialSupplier,
}: {
  suppliers: { id: string; name: string; trade_name: string | null; status: string }[];
  items: MovableItem[];
  units: Unit[];
  initial: PurchaseEditorInitial | null;
  initialSupplier?: string;
}) {
  const isOffline = useOffline();
  const [opId] = useState(() => crypto.randomUUID());
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? initialSupplier ?? "");
  const [expectedDate, setExpectedDate] = useState(initial?.expectedDate ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    initial
      ? initial.items.map((i) => ({ key: crypto.randomUUID(), item: i.item, quantity: toInput(i.quantity), unitId: i.unitId, unitPrice: toInput(i.unitPrice) }))
      : [{ key: crypto.randomUUID(), item: "", quantity: "", unitId: "", unitPrice: "" }],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const unitsById = new Map(units.map((u) => [u.id, u]));
  const itemsByKey = new Map(items.map((i) => [i.key, i]));
  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const total = rows.reduce((s, r) => {
    const q = parseDecimal(r.quantity);
    const p = parseDecimal(r.unitPrice || "0");
    return q > 0 && p >= 0 ? s + lineTotal(q, p) : s;
  }, 0);
  const selectable = suppliers.filter((s) => s.status === "active" || s.id === supplierId);

  if (!suppliers.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Cadastre um fornecedor primeiro em{" "}
        <Link href="/admin/fornecedores/novo" className="underline">
          Fornecedores
        </Link>
        .
      </p>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!supplierId) errs.supplier_id = "Selecione o fornecedor.";
    if (!rows.length) errs.items = "Inclua ao menos um item.";
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.item) errs[`row:${r.key}`] = "Selecione o item.";
      else if (seen.has(r.item)) errs[`row:${r.key}`] = "Item repetido.";
      else if (!(parseDecimal(r.quantity) > 0)) errs[`row:${r.key}`] = "Informe a quantidade.";
      else if (Number.isNaN(parseDecimal(r.unitPrice || "0")) || parseDecimal(r.unitPrice || "0") < 0) errs[`row:${r.key}`] = "Preço inválido.";
      seen.add(r.item);
    }
    setErrors(errs);
    setError(null);
    if (Object.keys(errs).length) return;

    start(async () => {
      const result = await savePurchaseOrderAction({
        op_id: opId,
        order_id: initial?.orderId ?? null,
        supplier_id: supplierId,
        expected_date: expectedDate,
        notes,
        items: rows.map((r) => ({
          item: r.item,
          quantity: r.quantity,
          unit_id: r.unitId || itemsByKey.get(r.item)?.unitId,
          unit_price: r.unitPrice || "0",
        })),
      });
      // sucesso redireciona para o pedido
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setError(result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? "Revise os campos destacados.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-3">
        <Field label="Fornecedor" htmlFor="supplier_id" error={errors.supplier_id} className="sm:col-span-2">
          <Select id="supplier_id" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-invalid={!!errors.supplier_id}>
            <option value="">Selecione…</option>
            {selectable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.trade_name || s.name}
                {s.status !== "active" ? " (inativo)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Previsão de entrega" htmlFor="expected_date" error={errors.expected_date}>
          <Input id="expected_date" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
        </Field>
      </fieldset>

      <div>
        <h3 className="mb-2 text-sm font-medium">Itens</h3>
        <ul className="space-y-3">
          {rows.map((r) => {
            const item = itemsByKey.get(r.item);
            const stockUnit = item ? unitsById.get(item.unitId) : undefined;
            const options = item && stockUnit ? compatibleUnits(units, stockUnit, item.density) : [];
            const unitId = r.unitId || item?.unitId || "";
            const q = parseDecimal(r.quantity);
            const p = parseDecimal(r.unitPrice || "0");
            const code = unitsById.get(unitId)?.code ?? "un";
            return (
              <li key={r.key} className="rounded-md border border-border p-3">
                <fieldset disabled={pending} className="grid gap-2 sm:grid-cols-[2fr_1fr_6rem_1fr_auto] sm:items-end">
                  <Field label="Item" htmlFor={`i-${r.key}`}>
                    <Select id={`i-${r.key}`} value={r.item} onChange={(e) => update(r.key, { item: e.target.value, unitId: "" })}>
                      <option value="">Selecione…</option>
                      <optgroup label="Matérias-primas">
                        {items.filter((i) => i.type === "raw_material").map((i) => (
                          <option key={i.key} value={i.key}>
                            {i.name}
                            {i.code ? ` · ${i.code}` : ""}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Produtos (revenda)">
                        {items.filter((i) => i.type === "product").map((i) => (
                          <option key={i.key} value={i.key}>
                            {i.name}
                            {i.code ? ` · ${i.code}` : ""}
                          </option>
                        ))}
                      </optgroup>
                    </Select>
                  </Field>
                  <Field label="Quantidade" htmlFor={`q-${r.key}`}>
                    <Input id={`q-${r.key}`} inputMode="decimal" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} />
                  </Field>
                  <Field label="Unidade" htmlFor={`u-${r.key}`}>
                    <Select id={`u-${r.key}`} value={unitId} onChange={(e) => update(r.key, { unitId: e.target.value })} disabled={!item}>
                      {options.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.code}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={`Preço (R$/${code})`} htmlFor={`p-${r.key}`}>
                    <Input id={`p-${r.key}`} inputMode="decimal" value={r.unitPrice} onChange={(e) => update(r.key, { unitPrice: e.target.value })} placeholder="0,00" />
                  </Field>
                  <Button type="button" variant="ghost" size="icon" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Remover item">
                    <Trash2 aria-hidden />
                  </Button>
                </fieldset>
                <p className="mt-1 text-xs text-muted-foreground">{q > 0 && p >= 0 ? `Subtotal ${formatMoney(lineTotal(q, p))}` : null}</p>
                <FieldError message={errors[`row:${r.key}`]} />
              </li>
            );
          })}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => setRows((rs) => [...rs, { key: crypto.randomUUID(), item: "", quantity: "", unitId: "", unitPrice: "" }])}
          disabled={pending}
        >
          <Plus aria-hidden /> Adicionar item
        </Button>
        <FieldError message={errors.items} />
      </div>

      <Field label="Observações" htmlFor="notes">
        <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} placeholder="Condição de pagamento, frete…" />
      </Field>

      <p className="text-lg">
        Total do pedido: <strong className="tabular-nums">{formatMoney(total)}</strong>
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || isOffline}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {initial ? "Salvar pedido" : "Criar pedido"}
        </Button>
        {isOffline && <span className="text-sm text-warning">Sem conexão: pedidos de compra são salvos só com o servidor.</span>}
        <FieldError message={error ?? undefined} />
      </div>
    </form>
  );
}
