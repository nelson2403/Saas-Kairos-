"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, CloudOff, Loader2 } from "lucide-react";
import { useOffline } from "next/offline";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Textarea } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { enqueue, removeOperation } from "@/lib/offline/queue";
import { formatCost, formatMoney, formatQuantity, parseDecimal } from "@/modules/inventory/domain";
import { formatOrderNumber } from "@/modules/production/domain";
import { completeOrderAction } from "../actions";

export type QueuedCompletionPayload = {
  order_id: string;
  produced_quantity: string;
  notes: string;
  items: { raw_material_id: string; quantity: string }[];
  /** Somente para exibição na lista de pendências. */
  label: string;
};

type Item = { id: string; name: string; unitCode: string; planned: number; available: number; cost: number | null };

const toInput = (n: number) => String(n).replace(".", ",");

export function CompleteForm({
  orderId,
  number,
  productName,
  productUnit,
  planned,
  items,
  userId,
  companyId,
}: {
  orderId: string;
  number: number;
  productName: string;
  productUnit: string;
  planned: number;
  items: Item[];
  userId: string;
  companyId: string;
}) {
  const isOffline = useOffline();
  const [opId] = useState(() => crypto.randomUUID());
  const [produced, setProduced] = useState(toInput(planned));
  const [actual, setActual] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, toInput(i.planned)])));
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(null);
  const [queued, setQueued] = useState(false);
  const [pending, start] = useTransition();
  const inflight = useRef<{ payload: QueuedCompletionPayload; queued: boolean } | null>(null);

  const p = parseDecimal(produced);
  const rows = items.map((i) => {
    const q = parseDecimal(actual[i.id] ?? "");
    return { ...i, q, short: q > i.available, total: i.cost == null || Number.isNaN(q) ? null : q * i.cost };
  });
  const missingCost = rows.some((r) => r.q > 0 && r.cost == null);
  const total = rows.reduce((s, r) => s + (r.total ?? 0), 0);
  const short = rows.filter((r) => r.short);

  async function queue(payload: QueuedCompletionPayload) {
    await enqueue({ id: opId, userId, companyId, operation: "production.complete", payload });
  }

  // Rede caiu com o envio em andamento: guarda também no aparelho com a mesma chave.
  useEffect(() => {
    const current = inflight.current;
    if (isOffline && current && !current.queued) {
      current.queued = true;
      void queue(current.payload);
    }
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!(p > 0)) errs.produced_quantity = "Informe quanto foi produzido.";
    for (const r of rows) if (Number.isNaN(r.q) || r.q < 0) errs[`item:${r.id}`] = "Consumo inválido.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const payload: QueuedCompletionPayload = {
      order_id: orderId,
      produced_quantity: produced,
      notes,
      items: items.map((i) => ({ raw_material_id: i.id, quantity: actual[i.id] })),
      label: `${formatOrderNumber(number)} · ${productName} · ${produced} ${productUnit}`,
    };

    if (isOffline) {
      void queue(payload).then(() => {
        setQueued(true);
        setFeedback({
          tone: "warning",
          text: "Conclusão guardada neste aparelho como pendente. O estoque só muda quando o servidor confirmar, ao voltar a conexão (acompanhe em Status do app).",
        });
      });
      return;
    }

    inflight.current = { payload, queued: false };
    start(async () => {
      const result = await completeOrderAction({
        op_id: opId,
        order_id: payload.order_id,
        produced_quantity: payload.produced_quantity,
        notes: payload.notes,
        items: payload.items,
      });
      const wasQueued = inflight.current?.queued;
      inflight.current = null;
      if (result.ok) {
        if (wasQueued) await removeOperation(opId);
        setFeedback({ tone: "success", text: result.message });
      } else {
        setErrors(result.fieldErrors ?? {});
        setFeedback({ tone: "danger", text: result.error ?? "Revise os campos destacados." });
      }
    });
  }

  if (queued) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-sm text-warning">
        <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        {feedback?.text}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {isOffline && (
        <p role="status" className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-sm text-warning">
          <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          Sem conexão. A conclusão será guardada no aparelho e enviada quando a conexão voltar. Se faltar insumo no servidor, ela fica como
          conflito para você decidir.
        </p>
      )}
      <fieldset disabled={pending} className="space-y-4">
        <Field
          label={`Quantidade produzida (${productUnit})`}
          htmlFor="produced_quantity"
          error={errors.produced_quantity}
          hint={p > 0 && p < planned ? `Perda de ${formatQuantity(planned - p, productUnit)} em relação ao planejado.` : "Somente o que ficou bom para venda."}
          className="max-w-xs"
        >
          <Input id="produced_quantity" inputMode="decimal" value={produced} onChange={(e) => setProduced(e.target.value)} />
        </Field>

        <div>
          <h3 className="mb-1 text-sm font-medium">Consumo real</h3>
          <p className="mb-2 text-xs text-muted-foreground">Já vem com o planejado. Ajuste se usou mais ou menos de algum insumo.</p>
          <Table>
            <thead>
              <tr>
                <Th>Matéria-prima</Th>
                <Th className="text-right">Planejado</Th>
                <Th className="text-right">Usado</Th>
                <Th className="text-right">Em estoque</Th>
                <Th className="text-right">Custo</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>{r.name}</Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">{formatQuantity(r.planned, r.unitCode)}</Td>
                  <Td className="text-right">
                    <div className="ml-auto flex max-w-36 items-center gap-1">
                      <Input
                        inputMode="decimal"
                        value={actual[r.id]}
                        onChange={(e) => setActual((a) => ({ ...a, [r.id]: e.target.value }))}
                        aria-label={`Consumo de ${r.name} em ${r.unitCode}`}
                        className="h-9 text-right"
                      />
                      <span className="text-xs text-muted-foreground">{r.unitCode}</span>
                    </div>
                    <FieldError message={errors[`item:${r.id}`]} />
                  </Td>
                  <Td className={`whitespace-nowrap text-right tabular-nums ${r.short ? "text-danger" : ""}`}>{formatQuantity(r.available, r.unitCode)}</Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">{r.total == null ? "sem custo" : formatMoney(r.total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>

        <p className="text-sm">
          Custo previsto: <strong className="tabular-nums">{formatMoney(total)}</strong>
          {p > 0 && <> · {formatCost(total / p)} por {productUnit}</>}
          {missingCost && <span className="block text-xs text-warning">Algum insumo está sem custo: o custo desta produção ficará incompleto.</span>}
        </p>
        {short.length > 0 && (
          <p className="text-sm text-danger">
            Saldo insuficiente de {short.map((s) => s.name).join(", ")}. A conclusão será recusada; registre a entrada desses insumos antes.
          </p>
        )}

        <Field label="Observações" htmlFor="complete-notes">
          <Textarea id="complete-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} />
        </Field>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCircle2 aria-hidden />}
          {pending && isOffline ? "Aguardando conexão…" : isOffline ? "Guardar conclusão como pendente" : "Concluir produção"}
        </Button>
        {feedback && (
          <p
            role={feedback.tone === "danger" ? "alert" : "status"}
            className={`text-sm ${feedback.tone === "success" ? "text-success" : feedback.tone === "warning" ? "text-warning" : "text-danger"}`}
          >
            {feedback.text}
          </p>
        )}
      </div>
    </form>
  );
}
