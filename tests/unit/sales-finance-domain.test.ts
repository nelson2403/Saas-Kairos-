import { describe, expect, it } from "vitest";
import { buildCashFlow, dueState, monthRange, parsePeriod } from "@/modules/finance/domain";
import { settleSchema, transactionSchema } from "@/modules/finance/schemas";
import { formatOrderNumber, orderTotals, todayBR } from "@/modules/sales/domain";
import { createOrderSchema, payOrderSchema } from "@/modules/sales/schemas";

const id = "3f1c2a1e-8a0b-4c9e-9f6a-1b2c3d4e5f60";
const id2 = "3f1c2a1e-8a0b-4c9e-9f6a-1b2c3d4e5f61";

describe("pedido", () => {
  it("totais em centavos por linha, desconto e frete (igual ao banco)", () => {
    expect(orderTotals([{ quantity: 3, unitPrice: 49.9 }], 10, 15)).toEqual({ subtotal: 149.7, total: 154.7 });
    expect(orderTotals([{ quantity: 3, unitPrice: 0.333 }])).toEqual({ subtotal: 1, total: 1 });
    expect(formatOrderNumber(42)).toBe("PED-0042");
  });

  it("validação: produto repetido, pagar agora exige forma, data futura recusada", () => {
    const base = { op_id: id, items: [{ product_id: id2, quantity: "2", unit_price: "10" }], discount: "", shipping: "", pay_now: false };
    expect(createOrderSchema.safeParse(base).success).toBe(true);
    expect(createOrderSchema.safeParse({ ...base, items: [...base.items, ...base.items] }).success).toBe(false);
    expect(createOrderSchema.safeParse({ ...base, pay_now: true }).success).toBe(false);
    expect(createOrderSchema.safeParse({ ...base, pay_now: true, method: "pix", paid_at: "2999-01-01" }).success).toBe(false);
    expect(payOrderSchema.safeParse({ op_id: id, order_id: id2, method: "boleto", paid_at: todayBR() }).success).toBe(true);
    expect(payOrderSchema.safeParse({ op_id: id, order_id: id2, method: "cheque" }).success).toBe(false);
  });
});

describe("financeiro", () => {
  it("fluxo de caixa diário com acumulado, ignorando fora do período", () => {
    const flow = buildCashFlow(
      [
        { type: "income", paid_at: "2026-11-02", paid_amount: 100 },
        { type: "expense", paid_at: "2026-11-02", paid_amount: 30.1 },
        { type: "expense", paid_at: "2026-11-05", paid_amount: 200 },
        { type: "income", paid_at: "2026-12-01", paid_amount: 999 },
      ],
      "2026-11-01",
      "2026-11-30",
    );
    expect(flow).toEqual([
      { date: "2026-11-02", income: 100, expense: 30.1, net: 69.9, balance: 69.9 },
      { date: "2026-11-05", income: 0, expense: 200, net: -200, balance: -130.1 },
    ]);
  });

  it("vencimento e período", () => {
    expect(dueState("2026-11-01", "2026-11-02")).toBe("overdue");
    expect(dueState("2026-11-02", "2026-11-02")).toBe("today");
    expect(monthRange("2026-02-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02-15").to).toBe("2028-02-29");
    expect(parsePeriod(undefined, undefined, "2026-11-28")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(parsePeriod("2026-12-31", "2026-01-01", "2026-11-28")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(parsePeriod("2020-01-01", "2026-01-01", "2026-11-28").to).toBe("2020-12-31"); // máximo de 1 ano
    expect(parsePeriod("lixo", "2026-01-xx", "2026-11-28")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  });

  it("lançamento: valor com 2 casas, data obrigatória; liquidação sem data futura", () => {
    const base = { type: "expense", category_id: id, description: "Aluguel", amount: "1.500,00", due_date: "2026-12-05" };
    const ok = transactionSchema.safeParse(base);
    expect(ok.success && ok.data.amount).toBe(1500);
    expect(transactionSchema.safeParse({ ...base, amount: "10,005" }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, due_date: "" }).success).toBe(false);
    expect(settleSchema.safeParse({ id, paid_at: "2999-01-01", amount: "10", method: "pix" }).success).toBe(false);
    expect(settleSchema.safeParse({ id, paid_at: todayBR(), amount: "10", method: "pix" }).success).toBe(true);
  });
});
