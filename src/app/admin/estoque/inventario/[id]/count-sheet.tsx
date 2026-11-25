"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/input";
import { EmptyState, Table, Td, Th } from "@/components/ui/table";
import { formatQuantity, parseDecimal } from "@/modules/inventory/domain";
import { applyCountAction, cancelCountAction, saveCountedAction } from "../actions";

type Item = {
  id: string;
  name: string;
  code: string | null;
  kind: string;
  unit: string;
  expected: number;
  current: number;
  counted: number | null;
};

const toInput = (n: number | null) => (n === null ? "" : String(n).replace(".", ","));

function CountRow({ item, editable }: { item: Item; editable: boolean }) {
  const [value, setValue] = useState(toInput(item.counted));
  const [saved, setSaved] = useState(toInput(item.counted));
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const counted = value.trim() === "" ? null : parseDecimal(value);
  const diff = counted === null || Number.isNaN(counted) ? null : counted - item.current;

  const save = () => {
    if (value === saved) return;
    start(async () => {
      const r = await saveCountedAction(item.id, value);
      if (r.ok) {
        setSaved(value);
        setError(null);
      } else setError(r.error ?? "Não foi possível salvar.");
    });
  };

  return (
    <tr>
      <Td>
        <span className="font-medium">{item.name}</span>
        <span className="block text-xs text-muted-foreground">
          {item.kind}
          {item.code ? ` · ${item.code}` : ""}
        </span>
      </Td>
      <Td className="whitespace-nowrap text-right tabular-nums">
        {formatQuantity(item.current, item.unit)}
        {item.current !== item.expected && (
          <span className="block text-xs text-warning">na abertura: {formatQuantity(item.expected, item.unit)}</span>
        )}
      </Td>
      <Td className="w-44">
        {editable ? (
          <div className="flex items-center gap-1.5">
            <Input
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), save())}
              aria-label={`Quantidade contada de ${item.name}`}
              aria-invalid={!!error}
              className="h-9 text-right"
            />
            <span className="w-8 text-xs text-muted-foreground">
              {saving ? <Loader2 className="size-4 animate-spin" aria-label="Salvando" /> : value === saved && saved !== "" ? <Check className="size-4 text-success" aria-label="Salvo" /> : item.unit}
            </span>
          </div>
        ) : (
          <span className="tabular-nums">{item.counted === null ? "—" : formatQuantity(item.counted, item.unit)}</span>
        )}
        {error && <FieldError message={error} />}
      </Td>
      <Td className={`whitespace-nowrap text-right tabular-nums ${diff ? (diff > 0 ? "text-success" : "text-danger") : "text-muted-foreground"}`}>
        {diff === null ? "—" : diff === 0 ? "sem diferença" : `${diff > 0 ? "+" : "−"}${formatQuantity(Math.abs(diff), item.unit)}`}
      </Td>
    </tr>
  );
}

export function CountSheet({
  countId,
  items,
  open,
  canCount,
  canApply,
}: {
  countId: string;
  items: Item[];
  open: boolean;
  canCount: boolean;
  canApply: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const visible = filter ? items.filter((i) => `${i.name} ${i.code ?? ""}`.toLowerCase().includes(filter.toLowerCase())) : items;

  if (!items.length) return <EmptyState title="Nenhum item ativo no momento da abertura." />;

  const act = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, confirmText: string) => {
    if (!confirm(confirmText)) return;
    start(async () => {
      const r = await fn();
      setMessage({ ok: r.ok, text: r.ok ? (r.message ?? "Concluído.") : (r.error ?? "Não foi possível concluir.") });
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {open && (
        <p className="text-sm text-muted-foreground">
          Digite a quantidade encontrada de cada item (salva automaticamente). Itens deixados em branco não são alterados.
          Ao aplicar, o saldo de cada item contado passa a ser exatamente a quantidade contada.
        </p>
      )}
      <Input type="search" placeholder="Filtrar itens…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar itens" />
      <Table>
        <thead>
          <tr>
            <Th>Item</Th>
            <Th className="text-right">Saldo no sistema</Th>
            <Th>Contado</Th>
            <Th className="text-right">Diferença</Th>
          </tr>
        </thead>
        <tbody>
          {visible.map((i) => (
            <CountRow key={i.id} item={i} editable={open && canCount} />
          ))}
        </tbody>
      </Table>
      {open && canApply && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={busy}
            onClick={() =>
              act(() => applyCountAction(countId), "Aplicar o inventário? Serão gerados ajustes de estoque para todos os itens contados com diferença.")
            }
          >
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            Aplicar inventário
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => act(() => cancelCountAction(countId), "Cancelar esta contagem? Nada será alterado no estoque.")}>
            Cancelar contagem
          </Button>
        </div>
      )}
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-success" : "text-danger"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
