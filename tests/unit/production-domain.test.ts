import { describe, expect, it } from "vitest";
import type { Unit } from "@/modules/inventory/domain";
import { estimateRecipeCost, formatOrderNumber, materialCost, requirement } from "@/modules/production/domain";
import { completeOrderSchema, recipeSchema } from "@/modules/production/schemas";

const u = (code: string, dimension: Unit["dimension"], factor: number): Unit => ({ id: code, code, name: code, dimension, factor_to_base: factor, company_id: null });
const g = u("g", "mass", 1);
const kg = u("kg", "mass", 1000);
const ml = u("ml", "volume", 1);
const un = u("un", "unit", 1);

describe("necessidade de insumos", () => {
  it("converte para a unidade de estoque, escala pelo rendimento e soma a perda (igual ao banco)", () => {
    // ficha: 800 g por 4 velas, estoque em kg, perda 10% → 10 velas = 2,2 kg
    expect(requirement({ quantity: 800, unit: g, stockUnit: kg, density: null }, 10, 4, 10)).toBeCloseTo(2.2, 6);
    expect(requirement({ quantity: 40, unit: ml, stockUnit: ml, density: null }, 10, 4, 10)).toBeCloseTo(110, 6);
  });

  it("volume → massa usa a densidade; sem densidade falha", () => {
    expect(requirement({ quantity: 100, unit: ml, stockUnit: g, density: 0.9 }, 1, 1, 0)).toBe(90);
    expect(() => requirement({ quantity: 100, unit: ml, stockUnit: g, density: null }, 1, 1, 0)).toThrow(/converter/);
  });
});

describe("custo estimado da ficha", () => {
  it("soma insumos e divide pelo rendimento", () => {
    const e = estimateRecipeCost(
      [
        { rawMaterialId: "cera", quantity: 200, unit: g, stockUnit: g, density: null, cost: 0.05 },
        { rawMaterialId: "pavio", quantity: 1, unit: un, stockUnit: un, density: null, cost: 0.5 },
      ],
      1,
      0,
    );
    expect(e.batchCost).toBe(10.5);
    expect(e.unitCost).toBe(10.5);
    expect(e.missingCost).toEqual([]);
  });

  it("perda aumenta o custo; insumo sem custo e unidade inválida são sinalizados", () => {
    const e = estimateRecipeCost(
      [
        { rawMaterialId: "cera", quantity: 400, unit: g, stockUnit: g, density: null, cost: 0.05 },
        { rawMaterialId: "essencia", quantity: 10, unit: ml, stockUnit: ml, density: null, cost: null },
        { rawMaterialId: "errado", quantity: 1, unit: ml, stockUnit: un, density: null, cost: 1 },
      ],
      2,
      10,
    );
    expect(e.batchCost).toBeCloseTo(22, 6); // 400 × 1,1 × 0,05
    expect(e.unitCost).toBeCloseTo(11, 6);
    expect(e.missingCost).toEqual(["essencia"]);
    expect(e.invalid).toEqual(["errado"]);
  });

  it("custo do insumo: médio quando há, senão o último", () => {
    expect(materialCost("0.0612", "0.05")).toBe(0.0612);
    expect(materialCost("0", "0.05")).toBe(0.05);
    expect(materialCost(null, null)).toBeNull();
  });

  it("número da ordem com zeros à esquerda", () => {
    expect(formatOrderNumber(7)).toBe("OP-0007");
    expect(formatOrderNumber(12345)).toBe("OP-12345");
  });
});

describe("validação", () => {
  const id = "3f1c2a1e-8a0b-4c9e-9f6a-1b2c3d4e5f60";
  const id2 = "3f1c2a1e-8a0b-4c9e-9f6a-1b2c3d4e5f61";

  it("ficha aceita decimais com vírgula e recusa insumo repetido", () => {
    const ok = recipeSchema.safeParse({ product_id: id, yield_quantity: "2,5", loss_percent: "", items: [{ raw_material_id: id2, quantity: "0,5", unit_id: id }] });
    expect(ok.success).toBe(false); // perda vazia → número inválido (a tela envia "0")
    const ok2 = recipeSchema.safeParse({ product_id: id, yield_quantity: "2,5", loss_percent: "0", items: [{ raw_material_id: id2, quantity: "0,5", unit_id: id }] });
    expect(ok2.success && ok2.data.yield_quantity).toBe(2.5);
    const dup = recipeSchema.safeParse({
      product_id: id,
      yield_quantity: "1",
      loss_percent: "0",
      items: [
        { raw_material_id: id2, quantity: "1", unit_id: id },
        { raw_material_id: id2, quantity: "2", unit_id: id },
      ],
    });
    expect(dup.success).toBe(false);
    const loss = recipeSchema.safeParse({ product_id: id, yield_quantity: "1", loss_percent: "100", items: [{ raw_material_id: id2, quantity: "1", unit_id: id }] });
    expect(loss.success).toBe(false);
  });

  it("conclusão aceita consumo zero, mas não produção zero", () => {
    const base = { op_id: id, order_id: id2, notes: "", items: [{ raw_material_id: id, quantity: "0" }] };
    expect(completeOrderSchema.safeParse({ ...base, produced_quantity: "3" }).success).toBe(true);
    expect(completeOrderSchema.safeParse({ ...base, produced_quantity: "0" }).success).toBe(false);
  });
});
