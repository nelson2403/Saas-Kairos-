export type TransactionType = "income" | "expense";
export type TransactionStatus = "open" | "paid" | "canceled";

export const TYPE_LABEL: Record<TransactionType, string> = { income: "Receita", expense: "Despesa" };
export const STATUS_LABEL: Record<TransactionStatus, string> = { open: "Em aberto", paid: "Liquidado", canceled: "Cancelado" };

export const SOURCE_LABEL: Record<string, string> = {
  order: "Pedido",
  order_refund: "Estorno de pedido",
  purchase_order: "Pedido de compra",
};

/** Situação de um lançamento em aberto em relação ao vencimento. */
export function dueState(dueDate: string, today: string): "overdue" | "today" | "future" {
  if (dueDate < today) return "overdue";
  return dueDate === today ? "today" : "future";
}

export type CashFlowDay = { date: string; income: number; expense: number; net: number; balance: number };

/**
 * Fluxo de caixa diário a partir de lançamentos liquidados (data da
 * liquidação). `balance` é o acumulado do período.
 */
export function buildCashFlow(rows: { type: TransactionType; paid_at: string; paid_amount: number }[], from: string, to: string): CashFlowDay[] {
  const byDay = new Map<string, { income: number; expense: number }>();
  for (const r of rows) {
    if (r.paid_at < from || r.paid_at > to) continue;
    const d = byDay.get(r.paid_at) ?? { income: 0, expense: 0 };
    d[r.type] += r.paid_amount;
    byDay.set(r.paid_at, d);
  }
  let balance = 0;
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => {
      const income = Math.round(v.income * 100) / 100;
      const expense = Math.round(v.expense * 100) / 100;
      const net = Math.round((income - expense) * 100) / 100;
      balance = Math.round((balance + net) * 100) / 100;
      return { date, income, expense, net, balance };
    });
}

/** Primeiro e último dia do mês de uma data AAAA-MM-DD. */
export function monthRange(date: string) {
  const [y, m] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}` };
}

/** Período válido vindo da URL (padrão: mês atual). Limita a 366 dias. */
export function parsePeriod(from: unknown, to: unknown, today: string) {
  const ok = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  const month = monthRange(today);
  let f = ok(from) ? from : month.from;
  let t = ok(to) ? to : month.to;
  if (f > t) [f, t] = [t, f];
  const maxEnd = new Date(Date.parse(f) + 365 * 86_400_000).toISOString().slice(0, 10);
  if (t > maxEnd) t = maxEnd;
  return { from: f, to: t };
}
