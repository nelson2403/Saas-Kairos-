import { Badge, Card, CardTitle } from "@/components/ui/card";
import { formatCost, formatQuantity } from "@/modules/inventory/domain";
import type { StockRow } from "@/modules/inventory/service";

export function StockSummary({ balance, minStock, extra }: { balance: StockRow | null; minStock: string; extra?: React.ReactNode }) {
  const unit = balance?.unit_code;
  return (
    <Card>
      <CardTitle className="mb-4">Estoque</CardTitle>
      <dl className="space-y-3 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">Saldo</dt>
          <dd className="text-lg font-medium tabular-nums">{formatQuantity(balance?.quantity ?? 0, unit)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Mínimo</dt>
          <dd className="tabular-nums">{Number(minStock) > 0 ? formatQuantity(minStock, unit) : "não definido"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Custo médio</dt>
          <dd className="tabular-nums">{balance && Number(balance.avg_cost) > 0 ? `${formatCost(balance.avg_cost)}/${unit}` : "—"}</dd>
        </div>
        {extra}
      </dl>
      {balance?.below_min && (
        <Badge tone="warning" className="mt-4">
          Abaixo do estoque mínimo
        </Badge>
      )}
    </Card>
  );
}
