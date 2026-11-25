import { z } from "zod";
import { parseDecimal } from "@/modules/inventory/domain";
import { PAYMENT_METHODS, todayBR } from "@/modules/sales/domain";

const money = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v !== "" && !Number.isNaN(parseDecimal(v)), `${label}: número inválido.`)
    .transform(parseDecimal)
    .refine((n) => n > 0, `${label}: deve ser maior que zero.`)
    .refine((n) => Number.isInteger(Math.round(n * 1e6) / 1e4), `${label}: no máximo 2 casas decimais.`);

const date = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label}: data inválida.`);
const optionalDate = z
  .string()
  .optional()
  .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Data inválida.")
  .transform((v) => (v ? v : null));
const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.uuid().nullable());

export const transactionSchema = z.object({
  type: z.enum(["income", "expense"]),
  category_id: z.uuid("Selecione a categoria."),
  description: z.string().trim().min(2, "Informe a descrição.").max(160),
  amount: money("Valor"),
  due_date: date("Vencimento"),
  competence_date: optionalDate,
  supplier_id: optionalUuid,
  customer_id: optionalUuid,
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : null)),
});

export const settleSchema = z.object({
  id: z.uuid(),
  paid_at: date("Data do pagamento").refine((v) => v <= todayBR(), "A data do pagamento não pode ser futura."),
  amount: money("Valor pago"),
  method: z.enum(PAYMENT_METHODS, "Informe a forma de pagamento."),
});

export const categorySchema = z.object({
  name: z.string().trim().min(2, "Informe o nome.").max(60),
  type: z.enum(["income", "expense"]),
});

export const payableSchema = z.object({
  order_id: z.uuid(),
  amount: money("Valor"),
  due_date: date("Vencimento"),
  description: z
    .string()
    .trim()
    .max(160)
    .optional()
    .transform((v) => (v ? v : null)),
});
