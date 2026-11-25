import { z } from "zod";
import { parseDecimal } from "@/modules/inventory/domain";

const uuid = z.uuid("Seleção inválida.");

/** Decimal vindo de formulário ("12,5"); `positive` exige > 0. */
const decimal = (label: string, { positive = true, max }: { positive?: boolean; max?: number } = {}) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "number" ? v : parseDecimal(v)))
    .refine((n) => !Number.isNaN(n), `${label}: número inválido.`)
    .refine((n) => (positive ? n > 0 : n >= 0), positive ? `${label}: deve ser maior que zero.` : `${label}: valor inválido.`)
    .refine((n) => max === undefined || n < max, `${label}: deve ser menor que ${max}.`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres.`)
    .optional()
    .transform((v) => (v ? v : null));

export const recipeSchema = z
  .object({
    product_id: uuid,
    yield_quantity: decimal("Rendimento"),
    loss_percent: decimal("Perda prevista", { positive: false, max: 100 }),
    notes: optionalText(2000),
    items: z
      .array(
        z.object({
          raw_material_id: uuid,
          quantity: decimal("Quantidade"),
          unit_id: uuid,
        }),
      )
      .min(1, "Inclua ao menos uma matéria-prima.")
      .max(100, "Máximo de 100 itens."),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.items.forEach((item, i) => {
      if (seen.has(item.raw_material_id))
        ctx.addIssue({ code: "custom", path: ["items", i], message: "Matéria-prima repetida na ficha." });
      seen.add(item.raw_material_id);
    });
  });
export type RecipeInput = z.output<typeof recipeSchema>;

export const createOrderSchema = z.object({
  op_id: uuid,
  product_id: z.uuid("Selecione o produto."),
  quantity: decimal("Quantidade"),
  notes: optionalText(2000),
});

export const completeOrderSchema = z.object({
  op_id: uuid,
  order_id: uuid,
  produced_quantity: decimal("Quantidade produzida"),
  notes: optionalText(2000),
  /** Consumo real por insumo, na unidade de estoque do insumo. */
  items: z.array(z.object({ raw_material_id: uuid, quantity: decimal("Consumo", { positive: false }) })).max(100),
});
export type CompleteOrderInput = z.output<typeof completeOrderSchema>;

export const cancelOrderSchema = z.object({
  order_id: uuid,
  reason: optionalText(300),
});

export const reverseOrderSchema = z.object({
  op_id: uuid,
  order_id: uuid,
  reason: z.string().trim().min(3, "Informe o motivo do estorno.").max(300),
});
