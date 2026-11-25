export type OrderStatus = "pending" | "paid" | "delivered" | "canceled" | "refunded";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Aguardando pagamento",
  paid: "Pago",
  delivered: "Entregue",
  canceled: "Cancelado",
  refunded: "Estornado",
};

export const ORDER_STATUS_TONE: Record<OrderStatus, "neutral" | "warning" | "success" | "danger"> = {
  pending: "warning",
  paid: "success",
  delivered: "neutral",
  canceled: "neutral",
  refunded: "danger",
};

export const PAYMENT_METHODS = ["pix", "dinheiro", "cartao_credito", "cartao_debito", "boleto", "transferencia", "outro"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  boleto: "Boleto",
  transferencia: "Transferência",
  outro: "Outro",
};

export const CHANNEL_LABEL = { manual: "Balcão / manual", loja: "Loja virtual" } as const;

export const formatOrderNumber = (n: number | string) => `PED-${String(n).padStart(4, "0")}`;

const cents = (n: number) => Math.round(n * 100) / 100;

/** Totais do pedido como o banco calcula (centavos por linha). */
export function orderTotals(items: { quantity: number; unitPrice: number }[], discount = 0, shipping = 0) {
  const subtotal = cents(items.reduce((s, i) => s + cents(i.quantity * i.unitPrice), 0));
  return { subtotal, total: cents(subtotal - cents(discount) + cents(shipping)) };
}

/** Data de hoje em Brasília (AAAA-MM-DD). */
export function todayBR() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
