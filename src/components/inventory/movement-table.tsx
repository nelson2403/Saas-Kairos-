import Link from "next/link";
import { Badge } from "@/components/ui/card";
import { EmptyState, Table, Td, Th } from "@/components/ui/table";
import { MOVEMENT_LABEL, formatCost, formatQuantity } from "@/modules/inventory/domain";
import type { Movement } from "@/modules/inventory/service";
import { ReverseButton } from "./reverse-button";

type Row = Movement & { author: string | null; reversed: boolean };

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

const SOURCE_LABEL: Record<string, string> = { inventory_count: "Inventário" };

export function MovementTable({ rows, canReverse, showItem = true }: { rows: Row[]; canReverse: boolean; showItem?: boolean }) {
  if (!rows.length) return <EmptyState title="Nenhuma movimentação registrada." />;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Data</Th>
          {showItem && <Th>Item</Th>}
          <Th>Tipo</Th>
          <Th className="text-right">Quantidade</Th>
          <Th className="text-right">Saldo</Th>
          <Th>Detalhes</Th>
          {canReverse && <Th className="sr-only">Ações</Th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const item = m.product ?? m.raw_material;
          const unit = item?.unit.code ?? "";
          const qty = Number(m.quantity);
          const reversible = canReverse && m.type !== "estorno" && !m.source_type && !m.reversed;
          const itemHref = m.product ? `/admin/produtos/${m.product.id}` : `/admin/materias-primas/${m.raw_material?.id}`;
          return (
            <tr key={m.id} className={m.reversed ? "text-muted-foreground" : undefined}>
              <Td className="whitespace-nowrap">{dateFormat.format(new Date(m.created_at))}</Td>
              {showItem && (
                <Td>
                  <Link href={itemHref} className="hover:underline">
                    {item?.name}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{m.product ? "Produto" : "Matéria-prima"}</span>
                </Td>
              )}
              <Td>
                <span className="flex flex-wrap items-center gap-1.5">
                  {MOVEMENT_LABEL[m.type] ?? m.type}
                  {m.reversed && <Badge>Estornada</Badge>}
                  {m.source_type === "production_order" && m.source_id ? (
                    <Link href={`/admin/producao/${m.source_id}`} className="hover:underline">
                      <Badge>Produção</Badge>
                    </Link>
                  ) : m.source_type === "order" && m.source_id ? (
                    <Link href={`/admin/pedidos/${m.source_id}`} className="hover:underline">
                      <Badge>Pedido</Badge>
                    </Link>
                  ) : m.source_type === "purchase_receipt" && m.source_id ? (
                    <Link href={`/admin/compras/recebimento/${m.source_id}`} className="hover:underline">
                      <Badge>Compra</Badge>
                    </Link>
                  ) : (
                    m.source_type && <Badge>{SOURCE_LABEL[m.source_type] ?? m.source_type}</Badge>
                  )}
                </span>
              </Td>
              <Td className={`whitespace-nowrap text-right tabular-nums ${qty > 0 ? "text-success" : "text-danger"}`}>
                {qty > 0 ? "+" : "−"}
                {formatQuantity(Math.abs(qty), unit)}
                {m.input_unit.code !== unit && (
                  <span className="block text-xs text-muted-foreground">
                    informado: {formatQuantity(Math.abs(Number(m.input_quantity)), m.input_unit.code)}
                  </span>
                )}
              </Td>
              <Td className="whitespace-nowrap text-right tabular-nums">{formatQuantity(m.balance_after, unit)}</Td>
              <Td className="max-w-64 text-xs text-muted-foreground">
                {m.reason && <span className="block text-foreground">{m.reason}</span>}
                {m.unit_cost && <span className="block">Custo {formatCost(m.unit_cost)}/{unit}</span>}
                {m.notes && <span className="block">{m.notes}</span>}
                {m.author && <span className="block">por {m.author}</span>}
              </Td>
              {canReverse && <Td className="text-right">{reversible && <ReverseButton movementId={m.id} />}</Td>}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
