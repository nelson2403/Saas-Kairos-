export type PurchaseStatus = "draft" | "ordered" | "partial" | "received" | "closed" | "canceled";

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  draft: "Rascunho",
  ordered: "Enviado",
  partial: "Recebido em parte",
  received: "Recebido",
  closed: "Encerrado",
  canceled: "Cancelado",
};

export const PURCHASE_STATUS_TONE: Record<PurchaseStatus, "neutral" | "warning" | "success" | "danger"> = {
  draft: "neutral",
  ordered: "warning",
  partial: "warning",
  received: "success",
  closed: "neutral",
  canceled: "danger",
};

/** Situações em que ainda se pode receber mercadoria. */
export const RECEIVABLE: ReadonlySet<PurchaseStatus> = new Set(["draft", "ordered", "partial"]);

export const formatPurchaseNumber = (n: number | string) => `PC-${String(n).padStart(4, "0")}`;

/** Total de uma linha arredondado em centavos (mesma regra do banco). */
export const lineTotal = (quantity: number, unitPrice: number) => Math.round(quantity * unitPrice * 100) / 100;
