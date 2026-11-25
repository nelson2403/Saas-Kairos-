import { z } from "zod";
import { parseDecimal } from "@/modules/inventory/domain";
import { PAYMENT_METHODS, todayBR } from "./domain";

const uuid = z.uuid("Seleção inválida.");

const decimal = (label: string, { positive = true } = {}) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "number" ? v : v.trim() === "" ? 0 : parseDecimal(v)))
    .refine((n) => !Number.isNaN(n), `${label}: número inválido.`)
    .refine((n) => (positive ? n > 0 : n >= 0), positive ? `${label}: deve ser maior que zero.` : `${label}: valor inválido.`);

const date = z
  .string()
  .optional()
  .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Data inválida.")
  .transform((v) => (v ? v : null));

export const createOrderSchema = z
  .object({
    op_id: uuid,
    customer_id: z
      .string()
      .optional()
      .transform((v) => (v ? v : null))
      .pipe(z.uuid().nullable()),
    items: z
      .array(z.object({ product_id: uuid, quantity: decimal("Quantidade"), unit_price: decimal("Preço", { positive: false }) }))
      .min(1, "Inclua ao menos um produto.")
      .max(200),
    discount: decimal("Desconto", { positive: false }),
    shipping: decimal("Frete", { positive: false }),
    due_date: date,
    notes: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((v) => (v ? v : null)),
    pay_now: z.boolean(),
    method: z.enum(PAYMENT_METHODS).optional(),
    paid_at: date,
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.items.forEach((i, idx) => {
      if (seen.has(i.product_id)) ctx.addIssue({ code: "custom", path: ["items", idx], message: "Produto repetido no pedido." });
      seen.add(i.product_id);
    });
    if (v.pay_now && !v.method) ctx.addIssue({ code: "custom", path: ["method"], message: "Informe a forma de pagamento." });
    if (v.paid_at && v.paid_at > todayBR()) ctx.addIssue({ code: "custom", path: ["paid_at"], message: "A data do pagamento não pode ser futura." });
  });

export const payOrderSchema = z
  .object({
    op_id: uuid,
    order_id: uuid,
    method: z.enum(PAYMENT_METHODS, "Informe a forma de pagamento."),
    paid_at: date,
  })
  .refine((v) => !v.paid_at || v.paid_at <= todayBR(), { path: ["paid_at"], message: "A data do pagamento não pode ser futura." });

export const cancelOrderSchema = z.object({
  order_id: uuid,
  reason: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null)),
});

export const refundOrderSchema = z.object({
  op_id: uuid,
  order_id: uuid,
  reason: z.string().trim().min(3, "Informe o motivo do estorno.").max(300),
});
