"use client";

import { useState, useTransition } from "react";
import { Loader2, PackageCheck } from "lucide-react";
import { useOffline } from "next/offline";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Textarea } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { formatMoney, formatQuantity, parseDecimal } from "@/modules/inventory/domain";
import { lineTotal } from "@/modules/purchasing/domain";
import { receivePurchaseAction } from "../actions";

type Line = { id: string; name: string; unitCode: string; pending: number; unitPrice: number };

const toInput = (n: number) => String(n).replace(".", ",");

/** Conferência da mercadoria: já vem com o pendente; ajuste o que realmente chegou. */
export function ReceiveForm({ orderId, lines }: { orderId: string; lines: Line[] }) {
  const isOffline = useOffline();
  const [opId, setOpId] = useState(() => crypto.randomUUID());
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, toInput(l.pending)])));
  const [price, setPrice] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, toInput(l.unitPrice)])));
  const [invoice, setInvoice] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const parsed = lines.map((l) => {
    const q = qty[l.id]?.trim() ? parseDecimal(qty[l.id]) : 0;
    const p = parseDecimal(price[l.id] || "0");
    return { ...l, q, p };
  });
  const total = parsed.reduce((s, l) => (l.q > 0 && l.p >= 0 ? s + lineTotal(l.q, l.p) : s), 0);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    for (const l of parsed) {
      if (Number.isNaN(l.q) || l.q < 0) errs[l.id] = "Quantidade inválida.";
      else if (l.q > l.pending + 1e-9) errs[l.id] = `Acima do pendente (${formatQuantity(l.pending, l.unitCode)}).`;
      else if (Number.isNaN(l.p) || l.p < 0) errs[l.id] = "Preço inválido.";
    }
    const items = parsed.filter((l) => l.q > 0);
    if (!items.length) errs.form = "Informe a quantidade recebida de ao menos um item.";
    setErrors(errs);
    setFeedback(null);
    if (Object.keys(errs).length) return;

    start(async () => {
      const result = await receivePurchaseAction({
        op_id: opId,
        order_id: orderId,
        invoice_number: invoice,
        notes,
        items: items.map((l) => ({ order_item_id: l.id, quantity: qty[l.id], unit_price: price[l.id] || "0" })),
      });
      if (result.ok) {
        setOpId(crypto.randomUUID());
        setFeedback({ ok: true, text: result.message });
      } else {
        setFeedback({ ok: false, text: result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? "Não foi possível registrar." });
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Table>
        <thead>
          <tr>
            <Th>Item</Th>
            <Th className="text-right">Pendente</Th>
            <Th className="text-right">Chegou</Th>
            <Th className="text-right">Preço unitário</Th>
          </tr>
        </thead>
        <tbody>
          {parsed.map((l) => (
            <tr key={l.id}>
              <Td>{l.name}</Td>
              <Td className="whitespace-nowrap text-right tabular-nums">{formatQuantity(l.pending, l.unitCode)}</Td>
              <Td className="text-right">
                <div className="ml-auto flex max-w-36 items-center gap-1">
                  <Input
                    inputMode="decimal"
                    value={qty[l.id]}
                    onChange={(e) => setQty((s) => ({ ...s, [l.id]: e.target.value }))}
                    aria-label={`Quantidade recebida de ${l.name} em ${l.unitCode}`}
                    className="h-9 text-right"
                    disabled={pending}
                  />
                  <span className="text-xs text-muted-foreground">{l.unitCode}</span>
                </div>
                <FieldError message={errors[l.id]} />
              </Td>
              <Td className="text-right">
                <Input
                  inputMode="decimal"
                  value={price[l.id]}
                  onChange={(e) => setPrice((s) => ({ ...s, [l.id]: e.target.value }))}
                  aria-label={`Preço por ${l.unitCode} de ${l.name}`}
                  className="ml-auto h-9 max-w-28 text-right"
                  disabled={pending}
                />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="text-sm">
        Valor recebido: <strong className="tabular-nums">{formatMoney(total)}</strong>
        <span className="block text-xs text-muted-foreground">Coloque 0 no que não chegou. O preço informado vira o custo de entrada no estoque.</span>
      </p>
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <Field label="Nota fiscal" htmlFor="invoice_number">
          <Input id="invoice_number" value={invoice} onChange={(e) => setInvoice(e.target.value)} maxLength={60} disabled={pending} />
        </Field>
        <Field label="Observações" htmlFor="receive-notes">
          <Textarea id="receive-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={1} disabled={pending} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || isOffline}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <PackageCheck aria-hidden />}
          Registrar recebimento
        </Button>
        {isOffline && <span className="text-sm text-warning">Sem conexão: o recebimento precisa do servidor.</span>}
        <FieldError message={errors.form} />
        {feedback && (
          <p role={feedback.ok ? "status" : "alert"} className={`text-sm ${feedback.ok ? "text-success" : "text-danger"}`}>
            {feedback.text}
          </p>
        )}
      </div>
    </form>
  );
}
