/**
 * Regras puras da produção (sem banco). Servem para a prévia na tela; o valor
 * que vale é sempre o calculado pelas funções do Postgres.
 */
import { ConversionError, convertQuantity, type Unit } from "@/modules/inventory/domain";

export type OrderStatus = "planned" | "completed" | "canceled" | "reversed";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  planned: "Em aberto",
  completed: "Concluída",
  canceled: "Cancelada",
  reversed: "Estornada",
};

export const ORDER_STATUS_TONE: Record<OrderStatus, "warning" | "success" | "neutral" | "danger"> = {
  planned: "warning",
  completed: "success",
  canceled: "neutral",
  reversed: "danger",
};

export const formatOrderNumber = (n: number | string) => `OP-${String(n).padStart(4, "0")}`;

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Insumo como a ficha técnica descreve (quantidade por rendimento, em qualquer unidade compatível). */
export type RecipeLine = {
  rawMaterialId: string;
  quantity: number;
  unit: Unit;
  stockUnit: Unit;
  density: number | null;
  /** Custo atual por unidade de estoque (médio; sem ele, o último). null = desconhecido. */
  cost: number | null;
};

/**
 * Necessidade de um insumo, na unidade de estoque, para produzir `quantity`
 * com uma receita que rende `yieldQty` e tem `lossPercent` de perda prevista.
 * Mesmo cálculo de fn_create_production_order.
 */
export function requirement(line: Pick<RecipeLine, "quantity" | "unit" | "stockUnit" | "density">, quantity: number, yieldQty: number, lossPercent: number) {
  const perYield = convertQuantity(line.quantity, line.unit, line.stockUnit, line.density);
  return round6(((perYield * quantity) / yieldQty) * (1 + lossPercent / 100));
}

export type CostEstimate = {
  /** Custo dos insumos para uma unidade do produto. */
  unitCost: number;
  /** Custo total da receita (um rendimento). */
  batchCost: number;
  /** Insumos sem custo conhecido (a estimativa fica incompleta). */
  missingCost: string[];
  /** Insumos cuja unidade não converte (ficha inválida). */
  invalid: string[];
  lines: { rawMaterialId: string; stockQuantity: number; cost: number | null; total: number | null }[];
};

/** Estimativa de custo da ficha técnica com os custos atuais dos insumos. */
export function estimateRecipeCost(lines: RecipeLine[], yieldQty: number, lossPercent: number): CostEstimate {
  const out: CostEstimate = { unitCost: 0, batchCost: 0, missingCost: [], invalid: [], lines: [] };
  for (const line of lines) {
    let stockQuantity: number;
    try {
      stockQuantity = requirement(line, yieldQty, yieldQty, lossPercent);
    } catch (e) {
      if (e instanceof ConversionError) {
        out.invalid.push(line.rawMaterialId);
        continue;
      }
      throw e;
    }
    const total = line.cost == null ? null : stockQuantity * line.cost;
    if (total == null) out.missingCost.push(line.rawMaterialId);
    else out.batchCost += total;
    out.lines.push({ rawMaterialId: line.rawMaterialId, stockQuantity, cost: line.cost, total });
  }
  out.batchCost = round6(out.batchCost);
  out.unitCost = yieldQty > 0 ? round6(out.batchCost / yieldQty) : 0;
  return out;
}

/** Custo por unidade de estoque de um insumo: médio quando há, senão o último informado. */
export function materialCost(avgCost: number | string | null | undefined, lastCost: number | string | null | undefined): number | null {
  const avg = Number(avgCost ?? 0);
  if (avg > 0) return avg;
  return lastCost == null ? null : Number(lastCost);
}
