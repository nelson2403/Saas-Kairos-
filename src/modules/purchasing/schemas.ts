import { z } from "zod";
import { parseDecimal } from "@/modules/inventory/domain";

const uuid = z.uuid("Seleção inválida.");

const decimal = (label: string, { positive = true } = {}) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "number" ? v : parseDecimal(v)))
    .refine((n) => !Number.isNaN(n), `${label}: número inválido.`)
    .refine((n) => (positive ? n > 0 : n >= 0), positive ? `${label}: deve ser maior que zero.` : `${label}: valor inválido.`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres.`)
    .optional()
    .transform((v) => (v ? v : null));

export const purchaseOrderSchema = z
  .object({
    op_id: uuid,
    order_id: uuid.nullable(),
    supplier_id: z.uuid("Selecione o fornecedor."),
    expected_date: z
      .string()
      .optional()
      .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Data inválida.")
      .transform((v) => (v ? v : null)),
    notes: optionalText(2000),
    items: z
      .array(
        z.object({
          item: z.string().regex(/^(product|raw_material):[0-9a-f-]{36}$/, "Selecione o item."),
          quantity: decimal("Quantidade"),
          unit_id: uuid,
          unit_price: decimal("Preço", { positive: false }),
        }),
      )
      .min(1, "Inclua ao menos um item.")
      .max(200, "Máximo de 200 itens."),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.items.forEach((i, idx) => {
      if (seen.has(i.item)) ctx.addIssue({ code: "custom", path: ["items", idx], message: "Item repetido no pedido." });
      seen.add(i.item);
    });
  })
  .transform((v) => ({
    ...v,
    items: v.items.map(({ item, ...rest }) => {
      const [item_type, item_id] = item.split(":");
      return { item_type, item_id, ...rest };
    }),
  }));

export const receiveSchema = z.object({
  op_id: uuid,
  order_id: uuid,
  invoice_number: optionalText(60),
  notes: optionalText(2000),
  items: z
    .array(z.object({ order_item_id: uuid, quantity: decimal("Quantidade"), unit_price: decimal("Preço", { positive: false }) }))
    .min(1, "Informe a quantidade recebida de ao menos um item."),
});

export const statusSchema = z.object({
  order_id: uuid,
  status: z.enum(["ordered", "canceled", "closed"]),
  reason: optionalText(300),
});

export const reverseReceiptSchema = z.object({
  op_id: uuid,
  receipt_id: uuid,
  reason: z.string().trim().min(3, "Informe o motivo do estorno.").max(300),
});
