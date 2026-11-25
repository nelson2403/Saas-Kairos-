"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CloudOff, Loader2 } from "lucide-react";
import { useOffline } from "next/offline";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState, Table, Td, Th } from "@/components/ui/table";
import { ConversionError, formatQuantity, parseDecimal } from "@/modules/inventory/domain";
import { requirement } from "@/modules/production/domain";
import type { ProducibleProduct } from "@/modules/production/service";
import { createOrderAction } from "../actions";

export function OrderForm({ products, initialProduct }: { products: ProducibleProduct[]; initialProduct: string }) {
  const isOffline = useOffline();
  const [opId] = useState(() => crypto.randomUUID());
  const [productId, setProductId] = useState(initialProduct);
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const product = products.find((p) => p.id === productId);
  const q = parseDecimal(quantity);
  const needs =
    product && q > 0
      ? product.lines.map((l) => {
          try {
            return { line: l, need: requirement(l, q, product.recipe.yield_quantity, product.recipe.loss_percent) };
          } catch (e) {
            if (e instanceof ConversionError) return { line: l, need: null };
            throw e;
          }
        })
      : [];
  const short = needs.filter((n) => n.need != null && n.need > n.line.available);

  if (!products.length) {
    return (
      <EmptyState title="Nenhum produto com ficha técnica ativa.">
        Monte a ficha técnica em <Link href="/admin/producao/fichas" className="underline">Fichas técnicas</Link> para poder produzir.
      </EmptyState>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!product) errs.product_id = "Selecione o produto.";
    if (!(q > 0)) errs.quantity = "Informe a quantidade a produzir.";
    setErrors(errs);
    setError(null);
    if (Object.keys(errs).length) return;
    start(async () => {
      // Em caso de sucesso a ação redireciona para a ordem.
      const result = await createOrderAction({ op_id: opId, product_id: productId, quantity, notes });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setError(result.error ?? "Revise os campos destacados.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
      {isOffline && (
        <p role="status" className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-sm text-warning sm:col-span-2">
          <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          Sem conexão. Abrir uma ordem exige o servidor (numeração e ficha técnica vigente). Tente quando a conexão voltar.
        </p>
      )}
      <Field label="Produto" htmlFor="product_id" error={errors.product_id}>
        <Select id="product_id" value={productId} onChange={(e) => setProductId(e.target.value)} aria-invalid={!!errors.product_id}>
          <option value="">Selecione…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.sku ? ` · ${p.sku}` : ""}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={`Quantidade a produzir${product ? ` (${product.unitCode})` : ""}`}
        htmlFor="quantity"
        error={errors.quantity}
        hint={product ? `Ficha v${product.recipe.version}: rende ${formatQuantity(product.recipe.yield_quantity, product.unitCode)} · perda ${formatQuantity(product.recipe.loss_percent)}%` : undefined}
      >
        <Input id="quantity" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-invalid={!!errors.quantity} />
      </Field>
      <Field label="Observações" htmlFor="notes" className="sm:col-span-2">
        <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} placeholder="Lote, encomenda, responsável…" />
      </Field>

      {needs.length > 0 && (
        <div className="sm:col-span-2">
          <h3 className="mb-2 text-sm font-medium">Necessidade de matérias-primas</h3>
          <Table>
            <thead>
              <tr>
                <Th>Matéria-prima</Th>
                <Th className="text-right">Necessário</Th>
                <Th className="text-right">Em estoque</Th>
              </tr>
            </thead>
            <tbody>
              {needs.map(({ line, need }) => (
                <tr key={line.rawMaterialId}>
                  <Td>{line.name}</Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">{need == null ? "unidade inválida" : formatQuantity(need, line.stockUnitCode)}</Td>
                  <Td className={`whitespace-nowrap text-right tabular-nums ${need != null && need > line.available ? "text-danger" : ""}`}>
                    {formatQuantity(line.available, line.stockUnitCode)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {short.length > 0 && (
            <p className="mt-2 text-sm text-warning">
              Falta estoque de {short.map((s) => s.line.name).join(", ")}. A ordem pode ser aberta, mas só será concluída com saldo suficiente
              (a conclusão nunca baixa parcialmente).
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending || isOffline}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Abrir ordem
        </Button>
        <FieldError message={error ?? undefined} />
      </div>
    </form>
  );
}
