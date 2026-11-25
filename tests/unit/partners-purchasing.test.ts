import { describe, expect, it } from "vitest";
import { formatAddress, formatPhone, formatPostalCode, maskDocument } from "@/modules/partners/domain";
import { anonymizeSchema, customerSchema, supplierSchema } from "@/modules/partners/schemas";
import { formatPurchaseNumber, lineTotal } from "@/modules/purchasing/domain";
import { purchaseOrderSchema, receiveSchema } from "@/modules/purchasing/schemas";

const id = "3f1c2a1e-8a0b-4c9e-9f6a-1b2c3d4e5f60";
const id2 = "3f1c2a1e-8a0b-4c9e-9f6a-1b2c3d4e5f61";

describe("formatação", () => {
  it("telefone, CEP e endereço", () => {
    expect(formatPhone("11987654321")).toBe("(11) 98765-4321");
    expect(formatPhone("1133334444")).toBe("(11) 3333-4444");
    expect(formatPhone("5511987654321")).toBe("(11) 98765-4321");
    expect(formatPostalCode("01310100")).toBe("01310-100");
    expect(formatAddress({ street: "Av. Paulista", address_number: "1000", complement: null, district: "Bela Vista", city: "São Paulo", state: "SP", postal_code: "01310100" })).toEqual([
      "Av. Paulista, 1000",
      "Bela Vista",
      "São Paulo/SP · 01310-100",
    ]);
  });

  it("CPF mascarado nas listas; CNPJ completo", () => {
    expect(maskDocument("52998224725")).toBe("***.982.247-**");
    expect(maskDocument("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("número do pedido e total por linha em centavos", () => {
    expect(formatPurchaseNumber(3)).toBe("PC-0003");
    expect(lineTotal(3, 0.333)).toBe(1);
    expect(lineTotal(5, 42.5)).toBe(212.5);
  });
});

describe("cliente", () => {
  const base = { name: "Maria", status: "active" };

  it("normaliza contato e endereço; valida CPF, telefone, CEP, UF", () => {
    const r = customerSchema.safeParse({ ...base, document: "529.982.247-25", phone: "(11) 98765-4321", postal_code: "01310-100", state: "sp", email: "Maria@Ex.com" });
    expect(r.success && r.data).toMatchObject({ document: "52998224725", phone: "11987654321", postal_code: "01310100", state: "SP", email: "maria@ex.com" });
    expect(customerSchema.safeParse({ ...base, document: "111.111.111-11" }).success).toBe(false);
    expect(customerSchema.safeParse({ ...base, phone: "1234" }).success).toBe(false);
    expect(customerSchema.safeParse({ ...base, postal_code: "123" }).success).toBe(false);
    expect(customerSchema.safeParse({ ...base, state: "XX" }).success).toBe(false);
  });

  it("consentimento só com a caixa marcada; campos vazios viram null", () => {
    const r = customerSchema.safeParse({ ...base, whatsapp_opt_in: "on", email: "", phone: "" });
    expect(r.success && r.data).toMatchObject({ whatsapp_opt_in: true, marketing_opt_in: false, email: null, phone: null });
  });

  it("data de nascimento no futuro é recusada", () => {
    expect(customerSchema.safeParse({ ...base, birth_date: "2999-01-01" }).success).toBe(false);
  });

  it("anonimização exige motivo e a palavra de confirmação", () => {
    expect(anonymizeSchema.safeParse({ customer_id: id, reason: "pedido do titular", confirm: "anonimizar" }).success).toBe(false);
    expect(anonymizeSchema.safeParse({ customer_id: id, reason: "pedido do titular", confirm: "ANONIMIZAR" }).success).toBe(true);
  });

  it("fornecedor aceita CNPJ", () => {
    expect(supplierSchema.safeParse({ name: "Ceras", status: "active", document: "11.222.333/0001-81" }).success).toBe(true);
  });
});

describe("pedido de compra", () => {
  const order = (items: unknown[]) => purchaseOrderSchema.safeParse({ op_id: id, order_id: null, supplier_id: id2, items });

  it("separa tipo e id do item; recusa item repetido e quantidade zero", () => {
    const ok = order([{ item: `raw_material:${id}`, quantity: "2,5", unit_id: id2, unit_price: "40" }]);
    expect(ok.success && ok.data.items[0]).toMatchObject({ item_type: "raw_material", item_id: id, quantity: 2.5, unit_price: 40 });
    expect(
      order([
        { item: `raw_material:${id}`, quantity: "1", unit_id: id2, unit_price: "1" },
        { item: `raw_material:${id}`, quantity: "2", unit_id: id2, unit_price: "1" },
      ]).success,
    ).toBe(false);
    expect(order([{ item: `product:${id}`, quantity: "0", unit_id: id2, unit_price: "1" }]).success).toBe(false);
    expect(order([]).success).toBe(false);
  });

  it("recebimento aceita preço zero (bonificação), não quantidade zero", () => {
    const base = { op_id: id, order_id: id2 };
    expect(receiveSchema.safeParse({ ...base, items: [{ order_item_id: id, quantity: "1", unit_price: "0" }] }).success).toBe(true);
    expect(receiveSchema.safeParse({ ...base, items: [{ order_item_id: id, quantity: "0", unit_price: "1" }] }).success).toBe(false);
  });
});
