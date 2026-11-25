import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireMembership, requireRole, type RoleKey } from "@/lib/auth/dal";
import { dbErrorMessage, isConflict, toFieldErrors, type ActionResult } from "@/lib/action-result";
import { CATALOG_ROLES, STOCK_ROLES } from "@/modules/inventory/service";
import type { OrderStatus, PaymentMethod } from "./domain";
import { cancelOrderSchema, createOrderSchema, payOrderSchema, refundOrderSchema } from "./schemas";

/** Quem vende (cria pedidos, registra pagamento, cancela, entrega). */
export const canSell = (role: RoleKey) => STOCK_ROLES.includes(role);
/** Quem estorna vendas pagas. */
export const canRefund = (role: RoleKey) => CATALOG_ROLES.includes(role);

export const ORDERS_PAGE_SIZE = 50;

export type OrderListItem = {
  id: string;
  number: number;
  channel: "manual" | "loja";
  status: OrderStatus;
  total: string;
  created_at: string;
  paid_at: string | null;
  due_date: string | null;
  customer: { id: string; name: string } | null;
};

const GROUPS: Record<string, OrderStatus[]> = {
  aguardando: ["pending"],
  pagos: ["paid"],
  entregues: ["delivered"],
  encerrados: ["canceled", "refunded"],
};

export async function listOrders(filters: { group?: string; customerId?: string; page?: number }) {
  await requireMembership();
  const supabase = await createClient();
  const page = Math.max(1, filters.page ?? 1);
  let query = supabase
    .from("orders")
    .select("id, number, channel, status, total, created_at, paid_at, due_date, customer:customers(id, name)", { count: "exact" })
    .order("number", { ascending: false })
    .range((page - 1) * ORDERS_PAGE_SIZE, page * ORDERS_PAGE_SIZE - 1);
  const statuses = filters.group ? GROUPS[filters.group] : undefined;
  if (statuses) query = query.in("status", statuses);
  if (filters.customerId) query = query.eq("customer_id", filters.customerId);
  const { data, error, count } = await query;
  if (error) throw new Error("Não foi possível carregar os pedidos.");
  return { rows: data as unknown as OrderListItem[], total: count ?? 0, page };
}

export async function countPendingOrders() {
  await requireMembership();
  const supabase = await createClient();
  const { count } = await supabase.from("orders").select("id", { count: "exact", head: true }).in("status", ["pending", "paid"]);
  return count ?? 0;
}

export type OrderDetail = OrderListItem & {
  subtotal: string;
  discount: string;
  shipping: string;
  notes: string | null;
  close_reason: string | null;
  delivered_at: string | null;
  closed_at: string | null;
  created_by: string | null;
  items: {
    id: string;
    product_id: string;
    quantity: string;
    unit_price: string;
    total: string;
    unit_cost: string | null;
    product: { id: string; name: string; sku: string | null; unit: { code: string } };
  }[];
  history: { id: number; status: OrderStatus; note: string | null; changed_by: string | null; created_at: string }[];
  payments: { id: string; method: PaymentMethod; amount: string; status: string; provider: string; confirmed_at: string | null; refunded_at: string | null }[];
  people: Record<string, string>;
};

export async function getOrder(id: string): Promise<OrderDetail | null> {
  await requireMembership();
  const supabase = await createClient();
  const [{ data }, { data: history }, { data: payments }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, number, channel, status, subtotal, discount, shipping, total, due_date, notes, close_reason, created_at, paid_at, delivered_at, closed_at, created_by, " +
          "customer:customers(id, name), items:order_items(id, product_id, quantity, unit_price, total, unit_cost, sort_order, product:products(id, name, sku, unit:measurement_units(code)))",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("order_status_history").select("id, status, note, changed_by, created_at").eq("order_id", id).order("id"),
    supabase.from("payments").select("id, method, amount, status, provider, confirmed_at, refunded_at").eq("order_id", id).order("created_at"),
  ]);
  if (!data) return null;
  const order = data as unknown as Omit<OrderDetail, "history" | "payments" | "people">;
  (order.items as (OrderDetail["items"][number] & { sort_order: number })[]).sort((a, b) => a.sort_order - b.sort_order);
  const hist = (history ?? []) as OrderDetail["history"];
  const ids = [...new Set([order.created_by, ...hist.map((h) => h.changed_by)].filter(Boolean))] as string[];
  const people: Record<string, string> = {};
  if (ids.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    for (const p of profiles ?? []) if (p.full_name) people[p.id as string] = p.full_name as string;
  }
  return { ...(order as unknown as OrderDetail), history: hist, payments: (payments ?? []) as OrderDetail["payments"], people };
}

export type SellableProduct = { id: string; name: string; sku: string | null; barcode: string | null; price: number; available: number; unitCode: string };

/** Produtos ativos com preço e quantidade disponível (saldo − reservado). */
export async function listSellableProducts(): Promise<SellableProduct[]> {
  await requireMembership();
  const supabase = await createClient();
  const [{ data: products, error }, { data: stock }] = await Promise.all([
    supabase.from("products").select("id, name, sku, barcode, sale_price, unit:measurement_units(code)").eq("status", "active").order("name"),
    supabase.from("stock_overview").select("item_id, available_quantity").eq("item_type", "product"),
  ]);
  if (error) throw new Error("Não foi possível carregar os produtos.");
  const available = new Map((stock ?? []).map((s) => [s.item_id as string, Number(s.available_quantity)]));
  return (products as unknown as { id: string; name: string; sku: string | null; barcode: string | null; sale_price: string; unit: { code: string } }[]).map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    price: Number(p.sale_price),
    available: available.get(p.id) ?? 0,
    unitCode: p.unit.code,
  }));
}

export async function listCustomerOptions() {
  await requireMembership();
  const supabase = await createClient();
  const { data } = await supabase.from("customers").select("id, name, phone").eq("status", "active").is("anonymized_at", null).order("name").limit(2000);
  return (data ?? []) as { id: string; name: string; phone: string | null }[];
}

export type CreateOrderResult = { order_id: string; number: number; total: string; status: OrderStatus; duplicate?: boolean };

export async function createOrder(input: unknown): Promise<ActionResult<CreateOrderResult> & { conflict?: boolean }> {
  await requireRole(STOCK_ROLES);
  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_order", {
    p_client_op_id: v.op_id,
    p_customer_id: v.customer_id,
    p_items: v.items,
    p_discount: v.discount,
    p_shipping: v.shipping,
    p_due_date: v.due_date,
    p_notes: v.notes,
    p_payment: v.pay_now ? { method: v.method, paid_at: v.paid_at } : null,
  });
  if (error) return { ok: false, error: dbErrorMessage(error), conflict: isConflict(error) };
  const result = data as CreateOrderResult;
  return { ok: true, message: result.status === "paid" ? "Venda registrada." : "Pedido criado: estoque reservado.", data: result };
}

export async function payOrder(input: Record<string, unknown>): Promise<ActionResult> {
  await requireRole(STOCK_ROLES);
  const parsed = payOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_register_order_payment", {
    p_client_op_id: parsed.data.op_id,
    p_order_id: parsed.data.order_id,
    p_method: parsed.data.method,
    p_paid_at: parsed.data.paid_at,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Pagamento registrado: venda efetivada e estoque baixado." };
}

export async function cancelOrder(input: Record<string, unknown>): Promise<ActionResult> {
  await requireRole(STOCK_ROLES);
  const parsed = cancelOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_cancel_order", { p_order_id: parsed.data.order_id, p_reason: parsed.data.reason });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Pedido cancelado: reserva liberada." };
}

export async function markDelivered(orderId: string): Promise<ActionResult> {
  await requireRole(STOCK_ROLES);
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_mark_order_delivered", { p_order_id: orderId });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Pedido marcado como entregue." };
}

export async function refundOrder(input: Record<string, unknown>): Promise<ActionResult> {
  await requireRole(CATALOG_ROLES);
  const parsed = refundOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_refund_order", {
    p_client_op_id: parsed.data.op_id,
    p_order_id: parsed.data.order_id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Venda estornada: estoque devolvido e saída lançada no caixa." };
}

// ---------------------------------------------------------------------------
// Vendas efetivadas (pedidos pagos)
// ---------------------------------------------------------------------------
export type SaleRow = {
  order_id: string;
  number: number;
  channel: string;
  customer_id: string | null;
  paid_at: string;
  paid_date: string;
  product_id: string;
  quantity: string;
  gross: string;
  net: string;
  cost: string;
  unit_cost: string | null;
};

/** Itens vendidos no período (data do pagamento, horário de Brasília). Limite de segurança: 20 mil linhas. */
export async function listSaleItems(from: string, to: string): Promise<SaleRow[]> {
  await requireMembership();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_items")
    .select("order_id, number, channel, customer_id, paid_at, paid_date, product_id, quantity, gross, net, cost, unit_cost")
    .gte("paid_date", from)
    .lte("paid_date", to)
    .order("paid_at")
    .limit(20000);
  if (error) throw new Error("Não foi possível carregar as vendas.");
  return data as SaleRow[];
}

/** Resumo de vendas do período: faturamento líquido de desconto + frete por pedido. */
export async function salesSummary(from: string, to: string) {
  await requireMembership();
  const supabase = await createClient();
  const start = new Date(`${from}T00:00:00-03:00`).toISOString();
  const end = new Date(new Date(`${to}T00:00:00-03:00`).getTime() + 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("orders")
    .select("total")
    .in("status", ["paid", "delivered"])
    .gte("paid_at", start)
    .lt("paid_at", end)
    .limit(20000);
  if (error) throw new Error("Não foi possível calcular as vendas.");
  const count = data.length;
  const revenue = Math.round(data.reduce((s, o) => s + Number(o.total), 0) * 100) / 100;
  return { count, revenue, ticket: count ? Math.round((revenue / count) * 100) / 100 : 0 };
}

/** Pedidos pagos no período (data do pagamento em Brasília). */
export async function listPaidOrders(from: string, to: string) {
  await requireMembership();
  const supabase = await createClient();
  const start = new Date(`${from}T00:00:00-03:00`).toISOString();
  const end = new Date(new Date(`${to}T00:00:00-03:00`).getTime() + 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("orders")
    .select("id, number, channel, status, total, created_at, paid_at, due_date, customer:customers(id, name)")
    .in("status", ["paid", "delivered"])
    .gte("paid_at", start)
    .lt("paid_at", end)
    .order("paid_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error("Não foi possível carregar as vendas.");
  return data as unknown as OrderListItem[];
}
