import { z } from "zod";
import { MANUAL_MOVEMENT_TYPES, REASON_REQUIRED, parseDecimal } from "./domain";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres.`)
    .optional()
    .transform((v) => (v ? v : null));

/** Número decimal vindo de formulário ("12,50"). */
const decimal = (opts: { min?: number; allowNegative?: boolean; label: string }) =>
  z
    .string()
    .trim()
    .refine((v) => v !== "" && !Number.isNaN(parseDecimal(v)), `${opts.label}: número inválido.`)
    .transform(parseDecimal)
    .refine((n) => opts.allowNegative || n >= (opts.min ?? 0), `${opts.label}: valor inválido.`);

const optionalDecimal = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || (!Number.isNaN(parseDecimal(v)) && parseDecimal(v) >= 0), `${label}: valor inválido.`)
    .transform((v) => (v ? parseDecimal(v) : null));

const uuid = z.uuid("Seleção inválida.");
const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.uuid().nullable());

const status = z.enum(["active", "inactive", "archived"]);

export const productSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome (mínimo 2 caracteres).").max(160),
  sku: optionalText(60),
  barcode: optionalText(48).refine((v) => !v || /^[0-9A-Za-z-]{4,48}$/.test(v), "Código de barras inválido."),
  category_id: optionalUuid,
  unit_id: uuid,
  sale_price: decimal({ label: "Preço de venda" }).refine(
    (n) => Number.isInteger(Math.round(n * 1e6) / 1e4),
    "Preço de venda: no máximo 2 casas decimais.",
  ),
  cost_price: optionalDecimal("Custo"),
  min_stock: optionalDecimal("Estoque mínimo").transform((v) => v ?? 0),
  description: optionalText(5000),
  status,
  show_in_store: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true"),
});
export type ProductInput = z.output<typeof productSchema>;

export const rawMaterialSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome (mínimo 2 caracteres).").max(160),
  code: optionalText(60),
  unit_id: uuid,
  density: optionalDecimal("Densidade").refine((v) => v === null || v > 0, "Densidade deve ser maior que zero."),
  min_stock: optionalDecimal("Estoque mínimo").transform((v) => v ?? 0),
  notes: optionalText(2000),
  status,
});
export type RawMaterialInput = z.output<typeof rawMaterialSchema>;

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(80),
  parent_id: optionalUuid,
});

export const unitSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]{1,12}$/, "Sigla: até 12 letras/números, sem espaços."),
  name: z.string().trim().min(1, "Informe o nome.").max(60),
  dimension: z.enum(["mass", "volume", "length", "unit"]),
  factor: decimal({ label: "Fator", min: 0 }).refine((n) => n > 0, "O fator deve ser maior que zero."),
});

export const movementSchema = z
  .object({
    op_id: uuid,
    item: z.string().regex(/^(product|raw_material):[0-9a-f-]{36}$/, "Selecione o item."),
    type: z.enum(MANUAL_MOVEMENT_TYPES, "Selecione o tipo."),
    quantity: decimal({ label: "Quantidade", allowNegative: true }),
    unit_id: uuid,
    unit_cost: optionalDecimal("Custo unitário"),
    reason: optionalText(300),
    notes: optionalText(2000),
  })
  .superRefine((v, ctx) => {
    if (v.quantity === 0) ctx.addIssue({ code: "custom", path: ["quantity"], message: "Informe a quantidade." });
    if (v.type !== "ajuste" && v.quantity < 0)
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "A quantidade deve ser positiva." });
    if (REASON_REQUIRED.has(v.type) && !v.reason)
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Informe o motivo." });
  })
  .transform((v) => {
    const [itemType, itemId] = v.item.split(":") as ["product" | "raw_material", string];
    return { ...v, itemType, itemId };
  });
export type MovementInput = z.output<typeof movementSchema>;

export const reversalSchema = z.object({
  op_id: uuid,
  movement_id: uuid,
  reason: z.string().trim().min(3, "Informe o motivo do estorno.").max(300),
});
