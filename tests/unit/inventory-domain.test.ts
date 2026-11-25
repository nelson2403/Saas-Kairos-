import { describe, expect, it } from "vitest";
import {
  ConversionError,
  compatibleUnits,
  convertQuantity,
  marginPercent,
  movementSign,
  parseDecimal,
  slugify,
  type Unit,
} from "@/modules/inventory/domain";
import { movementSchema, productSchema } from "@/modules/inventory/schemas";

const u = (code: string, dimension: Unit["dimension"], factor: number): Unit => ({
  id: code,
  code,
  name: code,
  dimension,
  factor_to_base: String(factor),
  company_id: null,
});
const g = u("g", "mass", 1);
const kg = u("kg", "mass", 1000);
const ml = u("ml", "volume", 1);
const l = u("l", "volume", 1000);
const un = u("un", "unit", 1);
const cx12 = u("cx12", "unit", 12);

describe("conversão de unidades (espelho da função do banco)", () => {
  it("converte dentro da mesma dimensão", () => {
    expect(convertQuantity(2, kg, g)).toBe(2000);
    expect(convertQuantity(250, g, kg)).toBe(0.25);
    expect(convertQuantity(3, cx12, un)).toBe(36);
  });

  it("massa ↔ volume só com densidade", () => {
    expect(() => convertQuantity(1, l, g)).toThrow(ConversionError);
    expect(convertQuantity(1, l, g, 0.9)).toBe(900);
    expect(convertQuantity(900, g, ml, 0.9)).toBe(1000);
  });

  it("recusa dimensões incompatíveis", () => {
    expect(() => convertQuantity(1, kg, un, 1)).toThrow(/converter/);
  });

  it("arredonda em 6 casas como numeric(18,6)", () => {
    expect(convertQuantity(1, g, kg)).toBe(0.001);
    expect(convertQuantity(1, u("mg", "mass", 0.001), kg)).toBe(0.000001);
  });

  it("lista só unidades compatíveis com o item", () => {
    const all = [g, kg, ml, l, un];
    expect(compatibleUnits(all, g).map((x) => x.code)).toEqual(["g", "kg"]);
    expect(compatibleUnits(all, g, 0.9).map((x) => x.code)).toEqual(["g", "kg", "ml", "l"]);
  });
});

describe("regras de movimentação", () => {
  it("sinal por tipo", () => {
    expect(movementSign("entrada", 5)).toBe(1);
    expect(movementSign("devolucao", 5)).toBe(1);
    expect(movementSign("saida", 5)).toBe(-1);
    expect(movementSign("perda", 5)).toBe(-1);
    expect(movementSign("ajuste", -2)).toBe(-1);
    expect(movementSign("ajuste", 2)).toBe(1);
  });

  const base = {
    op_id: "0b7c7c1e-8d3a-4f7e-9c55-2f4b7f0c9a11",
    item: "product:0b7c7c1e-8d3a-4f7e-9c55-2f4b7f0c9a12",
    unit_id: "0b7c7c1e-8d3a-4f7e-9c55-2f4b7f0c9a13",
  };

  it("valida a movimentação no servidor", () => {
    const ok = movementSchema.safeParse({ ...base, type: "entrada", quantity: "1,5", unit_cost: "12,90" });
    expect(ok.success && ok.data).toMatchObject({ quantity: 1.5, unit_cost: 12.9, itemType: "product" });

    expect(movementSchema.safeParse({ ...base, type: "saida", quantity: "-1" }).success).toBe(false);
    expect(movementSchema.safeParse({ ...base, type: "perda", quantity: "1" }).success).toBe(false); // sem motivo
    expect(movementSchema.safeParse({ ...base, type: "ajuste", quantity: "-2", reason: "Conferência" }).success).toBe(true);
    expect(movementSchema.safeParse({ ...base, type: "entrada", quantity: "0" }).success).toBe(false);
    expect(movementSchema.safeParse({ ...base, item: "product:../../x", type: "entrada", quantity: "1" }).success).toBe(false);
  });
});

describe("cadastro de produto", () => {
  const valid = { name: "Vela Âmbar", unit_id: "0b7c7c1e-8d3a-4f7e-9c55-2f4b7f0c9a13", sale_price: "89,90", status: "active" };

  it("aceita preço em formato brasileiro e normaliza vazios", () => {
    const r = productSchema.safeParse({ ...valid, sku: "", cost_price: "" });
    expect(r.success && r.data).toMatchObject({ sale_price: 89.9, sku: null, cost_price: null, min_stock: 0, show_in_store: false });
  });

  it("recusa preço com mais de 2 casas e código de barras inválido", () => {
    expect(productSchema.safeParse({ ...valid, sale_price: "10,555" }).success).toBe(false);
    expect(productSchema.safeParse({ ...valid, barcode: "12 34" }).success).toBe(false);
  });
});

describe("utilitários", () => {
  it("margem sobre o preço de venda", () => {
    expect(marginPercent(100, 60)).toBe(40);
    expect(marginPercent(0, 10)).toBeNull();
    expect(marginPercent(50, null)).toBeNull();
  });

  it("slug sem acentos", () => {
    expect(slugify("Vela Âmbar & Cedro 200g")).toBe("vela-ambar-cedro-200g");
  });

  it("números em formato brasileiro", () => {
    expect(parseDecimal("1.234,56")).toBe(1234.56);
    expect(parseDecimal("0,5")).toBe(0.5);
    expect(parseDecimal("12.5")).toBe(12.5);
    expect(parseDecimal("-2")).toBe(-2);
    expect(parseDecimal("abc")).toBeNaN();
    expect(parseDecimal("")).toBeNaN();
  });
});
