"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CloudOff, Loader2 } from "lucide-react";
import { useOffline } from "next/offline";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Select, Textarea } from "@/components/ui/input";
import { enqueue, removeOperation } from "@/lib/offline/queue";
import {
  ConversionError,
  MANUAL_MOVEMENT_TYPES,
  MOVEMENT_HELP,
  MOVEMENT_LABEL,
  REASON_REQUIRED,
  compatibleUnits,
  convertQuantity,
  formatQuantity,
  movementSign,
  parseDecimal,
  type ManualMovementType,
  type Unit,
} from "@/modules/inventory/domain";
import type { MovableItem } from "@/modules/inventory/service";
import { registerMovementAction } from "../actions";

export type QueuedMovementPayload = Record<string, string> & { itemName: string; unitCode: string };

type Feedback = { tone: "success" | "warning" | "danger"; text: string } | null;

export function MovementForm({
  items,
  units,
  userId,
  companyId,
  initialItem,
}: {
  items: MovableItem[];
  units: Unit[];
  userId: string;
  companyId: string;
  initialItem: string | null;
}) {
  const isOffline = useOffline();
  const [opId, setOpId] = useState(() => crypto.randomUUID());
  const [itemKey, setItemKey] = useState(initialItem && items.some((i) => i.key === initialItem) ? initialItem : "");
  const [type, setType] = useState<ManualMovementType>("entrada");
  const [quantity, setQuantity] = useState("");
  const [unitId, setUnitId] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [filter, setFilter] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();
  const inflight = useRef<{ opId: string; payload: QueuedMovementPayload; queued: boolean } | null>(null);

  const unitsById = new Map(units.map((u) => [u.id, u]));
  const item = items.find((i) => i.key === itemKey);
  const stockUnit = item ? unitsById.get(item.unitId) : undefined;
  const options = item && stockUnit ? compatibleUnits(units, stockUnit, item.density) : [];
  const selectedUnit = unitsById.get(unitId) ?? stockUnit;

  // Prévia: quanto entra/sai na unidade de estoque e o saldo resultante (o servidor decide).
  const preview = (() => {
    const q = parseDecimal(quantity);
    if (!item || !stockUnit || !selectedUnit || !q || Number.isNaN(q)) return null;
    try {
      const converted = convertQuantity(Math.abs(q), selectedUnit, stockUnit, item.density);
      const delta = movementSign(type, q) * converted;
      return { converted, delta, after: item.quantity + delta };
    } catch (e) {
      return e instanceof ConversionError ? { error: e.message } : null;
    }
  })();

  const filtered = filter
    ? items.filter((i) => `${i.name} ${i.code ?? ""}`.toLowerCase().includes(filter.toLowerCase()))
    : items;

  function reset(message: Feedback) {
    setOpId(crypto.randomUUID());
    setQuantity("");
    setUnitCost("");
    setReason("");
    setNotes("");
    setErrors({});
    setFeedback(message);
  }

  async function queue(id: string, payload: QueuedMovementPayload) {
    await enqueue({ id, userId, companyId, operation: "stock.movement", payload });
  }

  // Se a rede cair com o envio em andamento, guarda também na fila do aparelho
  // (mesma chave): sobrevive ao fechamento do app e não duplica.
  useEffect(() => {
    const current = inflight.current;
    if (isOffline && current && !current.queued) {
      current.queued = true;
      void queue(current.opId, current.payload);
    }
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!item) errs.item = "Selecione o item.";
    const q = parseDecimal(quantity);
    if (!q || Number.isNaN(q)) errs.quantity = "Informe a quantidade.";
    else if (type !== "ajuste" && q < 0) errs.quantity = "A quantidade deve ser positiva.";
    if (REASON_REQUIRED.has(type) && !reason.trim()) errs.reason = "Informe o motivo.";
    if (preview && "error" in preview && preview.error) errs.unit_id = preview.error;
    setErrors(errs);
    if (Object.keys(errs).length || !item || !selectedUnit) return;

    const payload: QueuedMovementPayload = {
      op_id: opId,
      item: item.key,
      type,
      quantity,
      unit_id: selectedUnit.id,
      unit_cost: unitCost,
      reason,
      notes,
      itemName: item.name,
      unitCode: selectedUnit.code,
    };

    if (isOffline) {
      void queue(opId, payload).then(() =>
        reset({
          tone: "warning",
          text: `${MOVEMENT_LABEL[type]} de ${item.name} salva no aparelho como pendente. Ela só altera o estoque quando o servidor confirmar, ao voltar a conexão.`,
        }),
      );
      return;
    }

    inflight.current = { opId, payload, queued: false };
    startTransition(async () => {
      const result = await registerMovementAction(payload);
      const wasQueued = inflight.current?.queued;
      inflight.current = null;
      if (result.ok) {
        if (wasQueued) await removeOperation(opId);
        reset({
          tone: "success",
          text: `${result.message} Saldo de ${item.name}: ${formatQuantity(result.data.balance_after, stockUnit?.code)}.`,
        });
      } else {
        setErrors(result.fieldErrors ?? {});
        setFeedback({ tone: "danger", text: result.error ?? "Revise os campos destacados." });
      }
    });
  }

  if (!items.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum item cadastrado. Cadastre um <Link href="/admin/produtos/novo" className="underline">produto</Link> ou uma{" "}
        <Link href="/admin/materias-primas/nova" className="underline">matéria-prima</Link> primeiro.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
      {isOffline && (
        <p role="status" className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-sm text-warning sm:col-span-2">
          <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          Sem conexão. A movimentação será guardada neste aparelho como pendente e enviada quando a conexão voltar. O
          saldo exibido pode estar desatualizado.
        </p>
      )}

      <Field label="Item" htmlFor="item" error={errors.item} className="sm:col-span-2">
        <Input
          type="search"
          placeholder="Filtrar por nome ou código…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filtrar itens"
          className="mb-2"
        />
        <Select
          id="item"
          value={itemKey}
          onChange={(e) => {
            setItemKey(e.target.value);
            setUnitId("");
          }}
          required
          aria-invalid={!!errors.item}
        >
          <option value="">Selecione…</option>
          <optgroup label="Produtos">
            {filtered.filter((i) => i.type === "product").map((i) => (
              <option key={i.key} value={i.key}>
                {i.name}
                {i.code ? ` · ${i.code}` : ""}
              </option>
            ))}
          </optgroup>
          <optgroup label="Matérias-primas">
            {filtered.filter((i) => i.type === "raw_material").map((i) => (
              <option key={i.key} value={i.key}>
                {i.name}
                {i.code ? ` · ${i.code}` : ""}
              </option>
            ))}
          </optgroup>
        </Select>
        {item && stockUnit && (
          <p className="text-xs text-muted-foreground">
            Saldo atual: {formatQuantity(item.quantity, stockUnit.code)} (no carregamento da tela)
          </p>
        )}
      </Field>

      <Field label="Tipo" htmlFor="type" hint={MOVEMENT_HELP[type]} className="sm:col-span-2">
        <Select id="type" value={type} onChange={(e) => setType(e.target.value as ManualMovementType)}>
          {MANUAL_MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_LABEL[t]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label={type === "ajuste" ? "Quantidade (+ ou −)" : "Quantidade"}
        htmlFor="quantity"
        error={errors.quantity}
        hint={
          preview && !("error" in preview) && selectedUnit?.id !== stockUnit?.id
            ? `= ${formatQuantity(preview.converted, stockUnit?.code)} na unidade de estoque`
            : undefined
        }
      >
        <Input
          id="quantity"
          inputMode={type === "ajuste" ? "text" : "decimal"}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder={type === "ajuste" ? "ex.: -2 ou 3" : "0"}
          aria-invalid={!!errors.quantity}
          required
        />
      </Field>
      <Field label="Unidade" htmlFor="unit_id" error={errors.unit_id}>
        <Select id="unit_id" value={selectedUnit?.id ?? ""} onChange={(e) => setUnitId(e.target.value)} disabled={!item}>
          {options.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.code})
            </option>
          ))}
        </Select>
      </Field>

      {(type === "entrada" || type === "devolucao" || (type === "ajuste" && parseDecimal(quantity) > 0)) && (
        <Field
          label={`Custo unitário (R$ por ${selectedUnit?.code ?? "unidade"})`}
          htmlFor="unit_cost"
          error={errors.unit_cost}
          hint="Opcional. Atualiza o custo médio do item."
        >
          <Input id="unit_cost" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0,00" />
        </Field>
      )}
      <Field
        label={REASON_REQUIRED.has(type) ? "Motivo" : "Motivo (opcional)"}
        htmlFor="reason"
        error={errors.reason}
        className={type === "entrada" || type === "devolucao" ? "" : "sm:col-span-2"}
      >
        <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} aria-invalid={!!errors.reason} />
      </Field>
      <Field label="Observações" htmlFor="notes" className="sm:col-span-2">
        <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} />
      </Field>

      {preview && !("error" in preview) && stockUnit && (
        <p className={`text-sm sm:col-span-2 ${preview.after < 0 ? "text-danger" : "text-muted-foreground"}`}>
          Saldo previsto: {formatQuantity(item?.quantity ?? 0, stockUnit.code)} → <strong>{formatQuantity(preview.after, stockUnit.code)}</strong>
          {preview.after < 0 && " (ficaria negativo; o servidor recusa se a empresa não permitir)"}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {pending && isOffline ? "Aguardando conexão…" : isOffline ? "Guardar como pendente" : "Registrar movimentação"}
        </Button>
        {feedback && (
          <p
            role={feedback.tone === "danger" ? "alert" : "status"}
            className={`text-sm ${feedback.tone === "success" ? "text-success" : feedback.tone === "warning" ? "text-warning" : "text-danger"}`}
          >
            {feedback.text}
          </p>
        )}
        {!feedback && Object.keys(errors).length > 0 && <FieldError message="Revise os campos destacados." />}
      </div>
    </form>
  );
}
