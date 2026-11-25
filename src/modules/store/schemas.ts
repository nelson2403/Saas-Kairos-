import { z } from "zod";
import { isValidCnpj, isValidCpf, onlyDigits } from "@/lib/validations/document";
import { UF } from "@/modules/partners/domain";
import { MAX_QTY_PER_ITEM } from "./domain";

const text = (max: number) => z.string().trim().max(max);

export const checkoutSchema = z
  .object({
    idempotency_key: z.uuid(),
    name: text(160).min(2, "Informe seu nome completo."),
    email: text(254).toLowerCase().pipe(z.email("E-mail inválido.")),
    phone: z
      .string()
      .transform(onlyDigits)
      .refine((v) => v.length >= 10 && v.length <= 13, "WhatsApp com DDD."),
    document: z
      .string()
      .optional()
      .transform((v) => onlyDigits(v ?? ""))
      .refine((v) => v === "" || isValidCpf(v) || isValidCnpj(v), "CPF ou CNPJ inválido.")
      .transform((v) => (v === "" ? null : v)),
    method: z.enum(["retirada", "entrega"], "Escolha retirada ou entrega."),
    postal_code: z.string().optional().transform((v) => onlyDigits(v ?? "")),
    street: text(160).optional(),
    address_number: text(20).optional(),
    complement: text(80).optional(),
    district: text(80).optional(),
    city: text(80).optional(),
    state: z.string().optional().transform((v) => (v ?? "").toUpperCase()),
    notes: text(1000).optional(),
    whatsapp_opt_in: z.boolean(),
    marketing_opt_in: z.boolean(),
    privacy: z.literal(true, "É preciso aceitar a Política de Privacidade."),
    /** Campo invisível: robôs costumam preencher. */
    website: z.string().max(0, "Envio inválido.").optional(),
    items: z
      .array(z.object({ product_id: z.uuid(), quantity: z.number().int().min(1).max(MAX_QTY_PER_ITEM) }))
      .min(1, "Seu carrinho está vazio.")
      .max(50),
  })
  .superRefine((v, ctx) => {
    if (v.method !== "entrega") return;
    if (v.postal_code.length !== 8) ctx.addIssue({ code: "custom", path: ["postal_code"], message: "CEP com 8 dígitos." });
    if (!v.street) ctx.addIssue({ code: "custom", path: ["street"], message: "Informe a rua." });
    if (!v.address_number) ctx.addIssue({ code: "custom", path: ["address_number"], message: "Informe o número." });
    if (!v.district) ctx.addIssue({ code: "custom", path: ["district"], message: "Informe o bairro." });
    if (!v.city) ctx.addIssue({ code: "custom", path: ["city"], message: "Informe a cidade." });
    if (!(UF as readonly string[]).includes(v.state)) ctx.addIssue({ code: "custom", path: ["state"], message: "Selecione a UF." });
  });
export type CheckoutInput = z.input<typeof checkoutSchema>;

export const storeSettingsSchema = z.object({
  enabled: z.boolean(),
  whatsapp: z
    .string()
    .transform(onlyDigits)
    .refine((v) => v === "" || (v.length >= 10 && v.length <= 13), "WhatsApp com DDD.")
    .transform((v) => (v === "" ? null : v)),
  pickup_enabled: z.boolean(),
  pickup_address: text(300).transform((v) => (v ? v : null)),
  delivery_enabled: z.boolean(),
  delivery_fee: z
    .string()
    .transform((v) => (v.trim() === "" ? 0 : Number(v.replace(/\./g, "").replace(",", "."))))
    .refine((n) => Number.isFinite(n) && n >= 0 && n <= 10000, "Taxa inválida."),
  delivery_notes: text(300).transform((v) => (v ? v : null)),
  payment_instructions: text(1000).min(5, "Explique como o cliente paga (ex.: Pix enviado pelo WhatsApp)."),
  reservation_hours: z.coerce.number().int("Horas inteiras.").min(1, "Mínimo 1 hora.").max(720, "Máximo 30 dias."),
});
