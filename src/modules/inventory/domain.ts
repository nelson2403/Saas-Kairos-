/**
 * Regras puras do estoque (sem acesso a banco). Espelham as regras do Postgres
 * para pré-visualização na tela; a decisão final é sempre do banco.
 */

export type Dimension = "mass" | "volume" | "length" | "unit";

export type Unit = {
  id: string;
  code: string;
  name: string;
  dimension: Dimension;
  factor_to_base: number | string;
  company_id: string | null;
};

export type ItemType = "product" | "raw_material";

export const MANUAL_MOVEMENT_TYPES = ["entrada", "saida", "ajuste", "perda", "descarte", "devolucao"] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export const MOVEMENT_LABEL: Record<string, string> = {
  entrada: "Entrada",
  saida: "Saída",
  ajuste: "Ajuste",
  perda: "Perda",
  descarte: "Descarte",
  devolucao: "Devolução",
  estorno: "Estorno",
  compra: "Compra",
  producao_consumo: "Consumo na produção",
  producao_entrada: "Entrada da produção",
  venda: "Venda",
};

export const MOVEMENT_HELP: Record<ManualMovementType, string> = {
  entrada: "Itens que chegaram (sem pedido de compra).",
  saida: "Itens que saíram por outro motivo que não venda.",
  ajuste: "Correção do saldo. Use + para aumentar e − para diminuir.",
  perda: "Itens perdidos ou danificados.",
  descarte: "Itens descartados (vencidos, defeituosos).",
  devolucao: "Itens que voltaram para o estoque.",
};

export const REASON_REQUIRED: ReadonlySet<string> = new Set(["ajuste", "perda", "descarte"]);

export const DIMENSION_LABEL: Record<Dimension, string> = {
  mass: "Massa",
  volume: "Volume",
  length: "Comprimento",
  unit: "Unidade",
};

export const BASE_UNIT: Record<Dimension, string> = { mass: "g", volume: "ml", length: "m", unit: "un" };

/** Sinal aplicado ao saldo para cada tipo manual (ajuste usa o sinal informado). */
export function movementSign(type: ManualMovementType, quantity: number): 1 | -1 {
  if (type === "entrada" || type === "devolucao") return 1;
  if (type === "ajuste") return quantity < 0 ? -1 : 1;
  return -1;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export class ConversionError extends Error {}

/** Converte quantidade entre unidades. Massa ↔ volume só com densidade (g/ml). */
export function convertQuantity(quantity: number, from: Unit, to: Unit, density?: number | null): number {
  if (from.id === to.id) return quantity;
  const base = quantity * Number(from.factor_to_base);
  const toFactor = Number(to.factor_to_base);
  if (from.dimension === to.dimension) return round6(base / toFactor);
  if (density && density > 0) {
    if (from.dimension === "volume" && to.dimension === "mass") return round6((base * density) / toFactor);
    if (from.dimension === "mass" && to.dimension === "volume") return round6(base / density / toFactor);
  }
  throw new ConversionError(`Não é possível converter ${from.code} para ${to.code}`);
}

/** Unidades em que um item com a unidade de estoque `stock` pode ser movimentado. */
export function compatibleUnits(units: Unit[], stock: Unit, density?: number | null): Unit[] {
  return units.filter((u) => {
    if (u.dimension === stock.dimension) return true;
    const pair = new Set([u.dimension, stock.dimension]);
    return Boolean(density && density > 0 && pair.has("mass") && pair.has("volume"));
  });
}

/** Margem sobre o preço de venda, em %. null se não houver custo ou preço. */
export function marginPercent(salePrice: number | null | undefined, cost: number | null | undefined): number | null {
  if (!salePrice || salePrice <= 0 || cost == null) return null;
  return Math.round(((salePrice - cost) / salePrice) * 10000) / 100;
}

/** Slug para URL a partir do nome ("Vela Âmbar 200g" → "vela-ambar-200g"). */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

const qtyFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const moneyFormat = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const costFormat = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 4 });

export const formatQuantity = (n: number | string, unit?: string) =>
  `${qtyFormat.format(Number(n))}${unit ? ` ${unit}` : ""}`;
export const formatMoney = (n: number | string | null | undefined) => (n == null ? "—" : moneyFormat.format(Number(n)));
export const formatCost = (n: number | string | null | undefined) => (n == null ? "—" : costFormat.format(Number(n)));

/** Aceita "1.234,56", "1234,56" ou "1234.56". Retorna NaN se inválido. */
export function parseDecimal(input: string): number {
  const s = input.trim().replace(/\s/g, "");
  if (!s) return NaN;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  return /^[-+]?\d*\.?\d+$/.test(normalized) ? Number(normalized) : NaN;
}

export const SCOPE_LABEL = { all: "Tudo", products: "Produtos", raw_materials: "Matérias-primas" } as const;
