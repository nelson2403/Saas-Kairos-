import { describe, expect, it } from "vitest";
import { availabilityLabel, parseCart, whatsappLink } from "@/modules/store/domain";
import { checkoutSchema, storeSettingsSchema } from "@/modules/store/schemas";

const id = "3f1c2a1e-8a0b-4c9e-9f6a-1b2c3d4e5f60";
const id2 = "3f1c2a1e-8a0b-4c9e-9f6a-1b2c3d4e5f61";

describe("carrinho no aparelho", () => {
  it("descarta formato inválido, repetidos e limita quantidade", () => {
    expect(parseCart(null)).toEqual([]);
    expect(parseCart("lixo")).toEqual([]);
    expect(parseCart(JSON.stringify({ id }))).toEqual([]);
    expect(
      parseCart(
        JSON.stringify([
          { id, qty: 2 },
          { id, qty: 5 },
          { id: "x", qty: 1 },
          { id: id2, qty: 0 },
          { id: id2, qty: 999 },
        ]),
      ),
    ).toEqual([
      { id, qty: 2 },
      { id: id2, qty: 50 },
    ]);
  });

  it("disponibilidade e link do WhatsApp", () => {
    expect(availabilityLabel(0).text).toBe("Esgotado");
    expect(availabilityLabel(2).text).toBe("Últimas 2 unidades");
    expect(availabilityLabel(10).tone).toBe("success");
    expect(whatsappLink("(11) 98765-4321", "Oi")).toBe("https://wa.me/5511987654321?text=Oi");
    expect(whatsappLink("5511987654321")).toBe("https://wa.me/5511987654321");
    expect(whatsappLink("123")).toBeNull();
  });
});

describe("checkout", () => {
  const base = {
    idempotency_key: id,
    name: "Ana Cliente",
    email: "ANA@EX.COM",
    phone: "(11) 98765-4321",
    document: "",
    method: "retirada",
    whatsapp_opt_in: false,
    marketing_opt_in: false,
    privacy: true,
    website: "",
    items: [{ product_id: id2, quantity: 2 }],
  };

  it("normaliza dados e aceita retirada sem endereço", () => {
    const r = checkoutSchema.safeParse(base);
    expect(r.success && r.data).toMatchObject({ email: "ana@ex.com", phone: "11987654321", document: null });
  });

  it("exige aceite da privacidade, recusa robô e CPF inválido", () => {
    expect(checkoutSchema.safeParse({ ...base, privacy: false }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, website: "http://spam" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, document: "111.111.111-11" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, items: [{ product_id: id2, quantity: 1.5 }] }).success).toBe(false);
  });

  it("entrega exige endereço completo", () => {
    const r = checkoutSchema.safeParse({ ...base, method: "entrega", postal_code: "01310-100", street: "Av. Paulista" });
    expect(r.success).toBe(false);
    const fields = r.success ? [] : r.error.issues.map((i) => i.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["address_number", "district", "city", "state"]));
    const ok = checkoutSchema.safeParse({ ...base, method: "entrega", postal_code: "01310-100", street: "Av. Paulista", address_number: "1000", district: "Bela Vista", city: "São Paulo", state: "sp" });
    expect(ok.success && ok.data.state).toBe("SP");
  });
});

describe("configuração da loja", () => {
  it("valida taxa, horas e instruções", () => {
    const base = { enabled: true, whatsapp: "", pickup_enabled: true, pickup_address: "", delivery_enabled: false, delivery_fee: "12,50", delivery_notes: "", payment_instructions: "Pix pelo WhatsApp", reservation_hours: "48" };
    const r = storeSettingsSchema.safeParse(base);
    expect(r.success && r.data).toMatchObject({ delivery_fee: 12.5, reservation_hours: 48, whatsapp: null, pickup_address: null });
    expect(storeSettingsSchema.safeParse({ ...base, reservation_hours: "0" }).success).toBe(false);
    expect(storeSettingsSchema.safeParse({ ...base, delivery_fee: "-1" }).success).toBe(false);
    expect(storeSettingsSchema.safeParse({ ...base, payment_instructions: "" }).success).toBe(false);
  });
});
