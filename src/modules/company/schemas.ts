import { z } from "zod";
import { optionalDocumentSchema } from "@/lib/validations/document";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

export const companySchema = z.object({
  name: z.string().trim().min(2, "Informe o nome (mínimo 2 caracteres).").max(120),
  legal_name: optionalText(200),
  document: optionalDocumentSchema,
  email: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === "" || z.email().safeParse(v).success, "E-mail inválido.")
    .transform((v) => (v === "" ? null : v)),
  phone: optionalText(30),
});

export type CompanyInput = z.input<typeof companySchema>;

export const onboardingSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da empresa.").max(120),
  document: optionalDocumentSchema,
});
