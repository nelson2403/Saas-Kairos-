import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/dal";
import { FINANCE_ROLES, cashFlow } from "@/modules/finance/service";
import { formatOrderNumber, CHANNEL_LABEL } from "@/modules/sales/domain";
import { listPaidOrders, listSaleItems } from "@/modules/sales/service";
import { getStockOverview } from "@/modules/inventory/service";

export type ColumnType = "text" | "money" | "qty" | "percent" | "date";
export type Column = { key: string; label: string; type: ColumnType };
export type Report = {
  title: string;
  subtitle: string;
  columns: Column[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, string | number | null>;
  note?: string;
};

export const REPORTS = {
  "vendas-pedidos": { label: "Vendas por pedido", period: true },
  "vendas-produtos": { label: "Vendas por produto (com margem)", period: true },
  "fluxo-caixa": { label: "Fluxo de caixa", period: true },
  "despesas-categorias": { label: "Despesas por categoria", period: true },
  "contas-abertas": { label: "Contas a pagar e a receber em aberto", period: false },
  estoque: { label: "Posição e valor do estoque", period: false },
} as const;
export type ReportKey = keyof typeof REPORTS;

const r2 = (n: number) => Math.round(n * 100) / 100;
const dateBR = (d: string) => d.split("-").reverse().join("/");

/** Monta o relatório (mesmos dados para a tela e para a exportação). Restrito a gerente+. */
export async function buildReport(key: ReportKey, from: string, to: string): Promise<Report> {
  await requireRole(FINANCE_ROLES);
  const period = `${dateBR(from)} a ${dateBR(to)}`;

  switch (key) {
    case "vendas-pedidos": {
      const orders = await listPaidOrders(from, to);
      const rows = [...orders].reverse().map((o) => ({
        pedido: formatOrderNumber(o.number),
        data: o.paid_at ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(o.paid_at)) : null,
        cliente: o.customer?.name ?? "—",
        canal: CHANNEL_LABEL[o.channel],
        total: Number(o.total),
      }));
      return {
        title: REPORTS[key].label,
        subtitle: period,
        columns: [
          { key: "pedido", label: "Pedido", type: "text" },
          { key: "data", label: "Pago em", type: "date" },
          { key: "cliente", label: "Cliente", type: "text" },
          { key: "canal", label: "Canal", type: "text" },
          { key: "total", label: "Total", type: "money" },
        ],
        rows,
        totals: { pedido: `${rows.length} vendas`, total: r2(rows.reduce((s, r) => s + r.total, 0)) },
      };
    }

    case "vendas-produtos": {
      const items = await listSaleItems(from, to);
      const supabase = await createClient();
      const ids = [...new Set(items.map((i) => i.product_id))];
      const names = new Map<string, { name: string; unit: string }>();
      if (ids.length) {
        const { data } = await supabase.from("products").select("id, name, unit:measurement_units(code)").in("id", ids);
        for (const p of (data ?? []) as unknown as { id: string; name: string; unit: { code: string } }[]) names.set(p.id, { name: p.name, unit: p.unit.code });
      }
      const by = new Map<string, { qty: number; net: number; cost: number; missing: boolean }>();
      for (const i of items) {
        const a = by.get(i.product_id) ?? { qty: 0, net: 0, cost: 0, missing: false };
        a.qty += Number(i.quantity);
        a.net += Number(i.net);
        a.cost += Number(i.cost);
        a.missing ||= i.unit_cost == null || Number(i.unit_cost) === 0;
        by.set(i.product_id, a);
      }
      const rows = [...by.entries()]
        .map(([id, a]) => ({
          produto: names.get(id)?.name ?? "Produto",
          unidade: names.get(id)?.unit ?? "",
          quantidade: a.qty,
          receita: r2(a.net),
          custo: r2(a.cost),
          lucro: r2(a.net - a.cost),
          margem: a.net > 0 ? r2(((a.net - a.cost) / a.net) * 100) : null,
          obs: a.missing ? "sem custo" : "",
        }))
        .sort((x, y) => y.receita - x.receita);
      const net = rows.reduce((s, r) => s + r.receita, 0);
      const cost = rows.reduce((s, r) => s + r.custo, 0);
      return {
        title: REPORTS[key].label,
        subtitle: period,
        columns: [
          { key: "produto", label: "Produto", type: "text" },
          { key: "quantidade", label: "Qtd.", type: "qty" },
          { key: "unidade", label: "Un.", type: "text" },
          { key: "receita", label: "Receita (líquida de desconto)", type: "money" },
          { key: "custo", label: "Custo", type: "money" },
          { key: "lucro", label: "Lucro bruto", type: "money" },
          { key: "margem", label: "Margem %", type: "percent" },
          { key: "obs", label: "Obs.", type: "text" },
        ],
        rows,
        totals: { produto: "Total", receita: r2(net), custo: r2(cost), lucro: r2(net - cost), margem: net > 0 ? r2(((net - cost) / net) * 100) : null },
        note: "Receita sem frete. Custo = custo médio do produto no momento da venda. \"sem custo\": produto sem custo cadastrado; o lucro fica superestimado.",
      };
    }

    case "fluxo-caixa": {
      const days = await cashFlow(from, to);
      return {
        title: REPORTS[key].label,
        subtitle: period,
        columns: [
          { key: "date", label: "Dia", type: "date" },
          { key: "income", label: "Entradas", type: "money" },
          { key: "expense", label: "Saídas", type: "money" },
          { key: "net", label: "Resultado", type: "money" },
          { key: "balance", label: "Acumulado", type: "money" },
        ],
        rows: days,
        totals: {
          date: "Total",
          income: r2(days.reduce((s, d) => s + d.income, 0)),
          expense: r2(days.reduce((s, d) => s + d.expense, 0)),
          net: r2(days.reduce((s, d) => s + d.net, 0)),
        },
        note: "Somente lançamentos liquidados, pela data da liquidação.",
      };
    }

    case "despesas-categorias": {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("financial_transactions")
        .select("paid_amount, category:financial_categories(name)")
        .eq("status", "paid")
        .eq("type", "expense")
        .gte("paid_at", from)
        .lte("paid_at", to)
        .limit(20000);
      if (error) throw new Error("Não foi possível carregar as despesas.");
      const by = new Map<string, { total: number; count: number }>();
      for (const t of data as unknown as { paid_amount: string; category: { name: string } }[]) {
        const a = by.get(t.category.name) ?? { total: 0, count: 0 };
        a.total += Number(t.paid_amount);
        a.count++;
        by.set(t.category.name, a);
      }
      const total = [...by.values()].reduce((s, a) => s + a.total, 0);
      const rows = [...by.entries()]
        .map(([categoria, a]) => ({ categoria, lancamentos: a.count, total: r2(a.total), participacao: total ? r2((a.total / total) * 100) : 0 }))
        .sort((x, y) => y.total - x.total);
      return {
        title: REPORTS[key].label,
        subtitle: period,
        columns: [
          { key: "categoria", label: "Categoria", type: "text" },
          { key: "lancamentos", label: "Lançamentos", type: "qty" },
          { key: "total", label: "Total pago", type: "money" },
          { key: "participacao", label: "% do total", type: "percent" },
        ],
        rows,
        totals: { categoria: "Total", total: r2(total) },
      };
    }

    case "contas-abertas": {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("financial_transactions")
        .select("type, description, amount, due_date, category:financial_categories(name), customer:customers(name), supplier:suppliers(name)")
        .eq("status", "open")
        .order("due_date")
        .limit(5000);
      if (error) throw new Error("Não foi possível carregar as contas.");
      type Row = { type: string; description: string; amount: string; due_date: string; category: { name: string }; customer: { name: string } | null; supplier: { name: string } | null };
      const rows = (data as unknown as Row[]).map((t) => ({
        tipo: t.type === "income" ? "A receber" : "A pagar",
        vencimento: t.due_date,
        descricao: t.description,
        pessoa: t.customer?.name ?? t.supplier?.name ?? "",
        categoria: t.category.name,
        valor: Number(t.amount),
      }));
      const sum = (tipo: string) => r2(rows.filter((r) => r.tipo === tipo).reduce((s, r) => s + r.valor, 0));
      return {
        title: REPORTS[key].label,
        subtitle: `Posição em ${dateBR(to)}`,
        columns: [
          { key: "tipo", label: "Tipo", type: "text" },
          { key: "vencimento", label: "Vencimento", type: "date" },
          { key: "descricao", label: "Descrição", type: "text" },
          { key: "pessoa", label: "Cliente / fornecedor", type: "text" },
          { key: "categoria", label: "Categoria", type: "text" },
          { key: "valor", label: "Valor", type: "money" },
        ],
        rows,
        totals: { tipo: `A receber ${sum("A receber").toFixed(2).replace(".", ",")} · A pagar ${sum("A pagar").toFixed(2).replace(".", ",")}` },
      };
    }

    case "estoque": {
      const stock = await getStockOverview({});
      const rows = stock
        .filter((s) => s.status !== "archived")
        .map((s) => ({
          item: s.name,
          tipo: s.item_type === "product" ? "Produto" : "Matéria-prima",
          quantidade: Number(s.quantity),
          reservado: Number(s.reserved_quantity),
          unidade: s.unit_code,
          custo_medio: Number(s.avg_cost),
          valor: r2(Math.max(Number(s.quantity), 0) * Number(s.avg_cost)),
        }));
      return {
        title: REPORTS[key].label,
        subtitle: `Posição atual`,
        columns: [
          { key: "item", label: "Item", type: "text" },
          { key: "tipo", label: "Tipo", type: "text" },
          { key: "quantidade", label: "Saldo", type: "qty" },
          { key: "reservado", label: "Reservado", type: "qty" },
          { key: "unidade", label: "Un.", type: "text" },
          { key: "custo_medio", label: "Custo médio", type: "money" },
          { key: "valor", label: "Valor em estoque", type: "money" },
        ],
        rows,
        totals: { item: "Total", valor: r2(rows.reduce((s, r) => s + r.valor, 0)) },
        note: "Valor = saldo × custo médio. Itens sem custo entram com valor zero.",
      };
    }
  }
}
