import { z } from "zod";
import { optionalDocumentSchema, onlyDigits } from "@/lib/validations/document";
import { UF } from "./domain";

/** CPF/CNPJ opcional mesmo quando o campo nem vem no envio. */
const document = z
  .string()
  .optional()
  .transform((v) => v ?? "")
  .pipe(optionalDocumentSchema);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres.`)
    .optional()
    .transform((v) => (v ? v : null));

const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");

const email = z
  .string()
  .trim()
  .max(254)
  .optional()
  .refine((v) => !v || z.email().safeParse(v).success, "E-mail inválido.")
  .transform((v) => (v ? v.toLowerCase() : null));

const phone = z
  .string()
  .optional()
  .transform((v) => onlyDigits(v ?? ""))
  .refine((v) => v === "" || (v.length >= 10 && v.length <= 13), "Telefone com DDD (10 ou 11 dígitos).")
  .transform((v) => (v === "" ? null : v));

const postalCode = z
  .string()
  .optional()
  .transform((v) => onlyDigits(v ?? ""))
  .refine((v) => v === "" || v.length === 8, "CEP com 8 dígitos.")
  .transform((v) => (v === "" ? null : v));

const state = z
  .string()
  .optional()
  .transform((v) => (v ? v.toUpperCase() : null))
  .refine((v) => v === null || (UF as readonly string[]).includes(v), "UF inválida.");

const address = {
  postal_code: postalCode,
  street: optionalText(160),
  address_number: optionalText(20),
  complement: optionalText(80),
  district: optionalText(80),
  city: optionalText(80),
  state,
};

export const customerSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome (mínimo 2 caracteres).").max(160),
  document,
  email,
  phone,
  birth_date: z
    .string()
    .optional()
    .refine((v) => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= "1900-01-01" && v <= new Date().toISOString().slice(0, 10)), "Data inválida.")
    .transform((v) => (v ? v : null)),
  ...address,
  notes: optionalText(2000),
  marketing_opt_in: checkbox,
  whatsapp_opt_in: checkbox,
  status: z.enum(["active", "inactive"]),
});
export type CustomerInput = z.output<typeof customerSchema>;

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Informe a razão social ou nome (mínimo 2 caracteres).").max(160),
  trade_name: optionalText(160),
  document,
  email,
  phone,
  contact_name: optionalText(120),
  ...address,
  notes: optionalText(2000),
  status: z.enum(["active", "inactive"]),
});
export type SupplierInput = z.output<typeof supplierSchema>;

export const anonymizeSchema = z.object({
  customer_id: z.uuid(),
  reason: z.string().trim().min(5, "Informe o motivo (ex.: solicitação do titular por e-mail em 10/12).").max(300),
  confirm: z.literal("ANONIMIZAR", { error: "Digite ANONIMIZAR para confirmar." }),
});
