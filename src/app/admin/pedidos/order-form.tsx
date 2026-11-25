"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useOffline } from "next/offline";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Select, Textarea } from "@/components/ui/input";
import { formatMoney, formatQuantity, parseDecimal } from "@/modules/inventory/domain";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, orderTotals, todayBR, type PaymentMethod } from "@/modules/sales/domain";
import type { SellableProduct } from "@/modules/sales/service";
import { createOrderAction } from "./actions";

type Row = { key: string; productId: string; quantity: string; unitPrice: string };

const toInput = (n: number) => String(n).replace(".", ",");
const num = (v: string) => (v.trim() === "" ? 0 : parseDecimal(v));

export function OrderForm({
  products,
  customers,
  payNowDefault,
  initialCustomer,
}: {
  products: SellableProduct[];
  customers: { id: string; name: string; phone: string | null }[];
  payNowDefault: boolean;
  initialCustomer?: string;
}) {
  const isOffline = useOffline();
  const [opId] = useState(() => crypto.randomUUID());
  const [customerFilter, setCustomerFilter] = useState("");
  const [customerId, setCustomerId] = useState(initialCustomer ?? "");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [discount, setDiscount] = useState("");
  const [shipping, setShipping] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [payNow, setPayNow] = useState(payNowDefault);
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [paidAt, setPaidAt] = useState(todayBR());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const byId = new Map(products.map((p) => [p.id, p]));
  const matches = search.trim()
    ? products.filter((p) => `${p.name} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 8)
    : [];
  const filteredCustomers = customerFilter
    ? customers.filter((c) => `${c.name} ${c.phone ?? ""}`.toLowerCase().includes(customerFilter.toLowerCase()))
    : customers;

  const lines = rows.map((r) => ({ ...r, q: num(r.quantity), p: num(r.unitPrice), product: byId.get(r.productId)! }));
  const totals = orderTotals(
    lines.filter((l) => l.q > 0 && l.p >= 0).map((l) => ({ quantity: l.q, unitPrice: l.p })),
    num(discount) || 0,
    num(shipping) || 0,
  );

  function add(product: SellableProduct) {
    setRows((rs) => {
      const existing = rs.find((r) => r.productId === product.id);
      if (existing) return rs.map((r) => (r === existing ? { ...r, quantity: toInput(num(r.quantity) + 1) } : r));
      return [...rs, { key: crypto.randomUUID(), productId: product.id, quantity: "1", unitPrice: toInput(product.price) }];
    });
    setSearch("");
  }

  /** Leitor USB digita o código e envia Enter: adiciona o produto exato. */
  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = search.trim();
    const exact = products.find((p) => p.barcode === code || p.sku?.toLowerCase() === code.toLowerCase());
    if (exact) add(exact);
    else if (matches.length === 1) add(matches[0]);
  }

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!rows.length) errs.items = "Inclua ao menos um produto.";
    for (const l of lines) {
      if (!(l.q > 0)) errs[`row:${l.key}`] = "Quantidade inválida.";
      else if (Number.isNaN(l.p) || l.p < 0) errs[`row:${l.key}`] = "Preço inválido.";
      else if (l.q > l.product.available) errs[`row:${l.key}`] = `Disponível: ${formatQuantity(l.product.available, l.product.unitCode)}.`;
    }
    if (Number.isNaN(num(discount)) || num(discount) < 0) errs.discount = "Desconto inválido.";
    if (Number.isNaN(num(shipping)) || num(shipping) < 0) errs.shipping = "Frete inválido.";
    if (totals.total < 0) errs.discount = "Desconto maior que o pedido.";
    if (payNow && !method) errs.method = "Informe a forma de pagamento.";
    setErrors(errs);
    setError(null);
    if (Object.keys(errs).length) return;

    start(async () => {
      const result = await createOrderAction({
        op_id: opId,
        customer_id: customerId,
        items: rows.map((r) => ({ product_id: r.productId, quantity: r.quantity, unit_price: r.unitPrice || "0" })),
        discount,
        shipping,
        due_date: payNow ? "" : dueDate,
        notes,
        pay_now: payNow,
        method: payNow ? method : undefined,
        paid_at: payNow ? paidAt : "",
      });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setError(result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? "Revise os campos destacados.");
      }
    });
  }

  if (!products.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum produto ativo. Cadastre em <Link href="/admin/produtos/novo" className="underline">Produtos</Link>.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
        <Field label="Cliente (opcional)" htmlFor="customer_id">
          <Input type="search" placeholder="Filtrar por nome ou telefone…" value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} aria-label="Filtrar clientes" className="mb-2" />
          <Select id="customer_id" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Sem cliente identificado</option>
            {filteredCustomers.slice(0, 300).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Link href="/admin/clientes/novo" className="text-xs text-muted-foreground underline" target="_blank">
            Cadastrar cliente novo (abre em outra aba)
          </Link>
        </Field>

        <Field label="Adicionar produto" htmlFor="product-search" hint="Digite o nome ou leia o código de barras." error={errors.items}>
          <Input
            id="product-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Nome, SKU ou código de barras"
            autoComplete="off"
          />
          {matches.length > 0 && (
            <ul className="mt-1 max-h-64 overflow-auto rounded-md border border-border bg-surface">
              {matches.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => add(p)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
                    <span>
                      {p.name}
                      {p.sku && <span className="text-muted-foreground"> · {p.sku}</span>}
                    </span>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatMoney(p.price)} · disp. {formatQuantity(p.available, p.unitCode)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Field>
      </fieldset>

      {lines.length > 0 && (
        <ul className="space-y-2">
          {lines.map((l) => (
            <li key={l.key} className="rounded-md border border-border p-3">
              <fieldset disabled={pending} className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
                <div>
                  <p className="text-sm font-medium">{l.product.name}</p>
                  <p className="text-xs text-muted-foreground">Disponível: {formatQuantity(l.product.available, l.product.unitCode)}</p>
                </div>
                <Field label="Quantidade" htmlFor={`q-${l.key}`}>
                  <Input id={`q-${l.key}`} inputMode="decimal" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
                </Field>
                <Field label="Preço (R$)" htmlFor={`p-${l.key}`}>
                  <Input id={`p-${l.key}`} inputMode="decimal" value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value })} />
                </Field>
                <p className="pb-3 text-right text-sm tabular-nums">{l.q > 0 && l.p >= 0 ? formatMoney(Math.round(l.q * l.p * 100) / 100) : "—"}</p>
                <Button type="button" variant="ghost" size="icon" onClick={() => setRows((rs) => rs.filter((r) => r.key !== l.key))} aria-label={`Remover ${l.product.name}`}>
                  <Trash2 aria-hidden />
                </Button>
              </fieldset>
              <FieldError message={errors[`row:${l.key}`]} />
            </li>
          ))}
        </ul>
      )}

      <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-3">
        <Field label="Desconto (R$)" htmlFor="discount" error={errors.discount}>
          <Input id="discount" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0,00" />
        </Field>
        <Field label="Frete / entrega (R$)" htmlFor="shipping" error={errors.shipping}>
          <Input id="shipping" inputMode="decimal" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0,00" />
        </Field>
        <div className="flex flex-col justify-end text-right">
          <span className="text-sm text-muted-foreground">Subtotal {formatMoney(totals.subtotal)}</span>
          <span className="text-2xl tabular-nums">{formatMoney(totals.total)}</span>
        </div>
      </fieldset>

      <fieldset disabled={pending} className="rounded-md border border-border p-4">
        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} className="size-4 accent-tinta" />
          Pagamento recebido agora (venda no balcão)
        </label>
        {payNow ? (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Forma de pagamento" htmlFor="method" error={errors.method}>
              <Select id="method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                <option value="">Selecione…</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Data do pagamento" htmlFor="paid_at" error={errors.paid_at}>
              <Input id="paid_at" type="date" value={paidAt} max={todayBR()} onChange={(e) => setPaidAt(e.target.value)} />
            </Field>
            <p className="text-xs text-muted-foreground sm:col-span-2">O estoque é baixado e a venda entra no faturamento ao salvar.</p>
          </div>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Vencimento do pagamento" htmlFor="due_date" hint="Opcional. Vira a data da conta a receber.">
              <Input id="due_date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <p className="self-end text-xs text-muted-foreground">O estoque fica reservado até registrar o pagamento ou cancelar o pedido.</p>
          </div>
        )}
      </fieldset>

      <Field label="Observações" htmlFor="notes">
        <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} placeholder="Entrega, presente, personalização…" />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || isOffline || rows.length === 0}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
          {payNow ? "Registrar venda" : "Criar pedido"}
        </Button>
        {isOffline && <span className="text-sm text-warning">Sem conexão: vendas e pedidos só são registrados com o servidor.</span>}
        <FieldError message={error ?? undefined} />
      </div>
    </form>
  );
}
