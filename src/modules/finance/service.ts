import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireRole, type RoleKey } from "@/lib/auth/dal";
import { dbErrorMessage, toFieldErrors, type ActionResult } from "@/lib/action-result";
import { CATALOG_ROLES } from "@/modules/inventory/service";
import type { PaymentMethod } from "@/modules/sales/domain";
import { buildCashFlow, type TransactionStatus, type TransactionType } from "./domain";
import { categorySchema, payableSchema, settleSchema, transactionSchema } from "./schemas";

/** Financeiro é visível e editável por proprietário, administrador e gerente. */
export const FINANCE_ROLES: RoleKey[] = CATALOG_ROLES;
export const canSeeFinance = (role: RoleKey) => FINANCE_ROLES.includes(role);

export type Category = { id: string; name: string; type: TransactionType; company_id: string | null; active: boolean };

export type Transaction = {
  id: string;
  type: TransactionType;
  description: string;
  amount: string;
  due_date: string;
  competence_date: string;
  status: TransactionStatus;
  paid_at: string | null;
  paid_amount: string | null;
  payment_method: PaymentMethod | null;
  source_type: string | null;
  source_id: string | null;
  notes: string | null;
  category: { id: string; name: string };
  customer: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
};

const TX_SELECT =
  "id, type, description, amount, due_date, competence_date, status, paid_at, paid_amount, payment_method, source_type, source_id, notes, " +
  "category:financial_categories(id, name), customer:customers(id, name), supplier:suppliers(id, name)";

export async function listCategories(): Promise<Category[]> {
  await requireRole(FINANCE_ROLES);
  const supabase = await createClient();
  const { data } = await supabase.from("financial_categories").select("id, name, type, company_id, active").order("type").order("name");
  return (data ?? []) as Category[];
}

export async function createCategory(input: Record<string, unknown>): Promise<ActionResult> {
  const { companyId } = await requireRole(FINANCE_ROLES);
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.from("financial_categories").insert({ ...parsed.data, company_id: companyId });
  if (error) return { ok: false, error: error.code === "23505" ? "Já existe uma categoria com este nome." : dbErrorMessage(error) };
  return { ok: true, message: "Categoria criada." };
}

export type TransactionView = "receber" | "pagar" | "liquidados";

export async function listTransactions(filters: { view: TransactionView; from?: string; to?: string }) {
  await requireRole(FINANCE_ROLES);
  const supabase = await createClient();
  let query = supabase.from("financial_transactions").select(TX_SELECT).limit(1000);
  if (filters.view === "liquidados") {
    query = query.eq("status", "paid").order("paid_at", { ascending: false });
    if (filters.from) query = query.gte("paid_at", filters.from);
    if (filters.to) query = query.lte("paid_at", filters.to);
  } else {
    query = query
      .eq("status", "open")
      .eq("type", filters.view === "receber" ? "income" : "expense")
      .order("due_date");
    if (filters.to) query = query.lte("due_date", filters.to);
  }
  const { data, error } = await query;
  if (error) throw new Error("Não foi possível carregar os lançamentos.");
  return data as unknown as Transaction[];
}

export async function getTransaction(id: string) {
  await requireRole(FINANCE_ROLES);
  const supabase = await createClient();
  const { data } = await supabase.from("financial_transactions").select(TX_SELECT).eq("id", id).maybeSingle();
  return data as unknown as Transaction | null;
}

export async function listSourceTransactions(sourceType: string, sourceId: string) {
  await requireRole(FINANCE_ROLES);
  const supabase = await createClient();
  const { data } = await supabase.from("financial_transactions").select(TX_SELECT).eq("source_type", sourceType).eq("source_id", sourceId).order("due_date");
  return (data ?? []) as unknown as Transaction[];
}

/** Totais em aberto (a receber, a pagar, vencidos) para os cartões do topo. */
export async function openTotals(today: string) {
  await requireRole(FINANCE_ROLES);
  const supabase = await createClient();
  const { data, error } = await supabase.from("financial_transactions").select("type, amount, due_date").eq("status", "open").limit(10000);
  if (error) throw new Error("Não foi possível calcular os totais.");
  const t = { receivable: 0, payable: 0, overdueReceivable: 0, overduePayable: 0, overdueCount: 0 };
  for (const r of data) {
    const v = Number(r.amount);
    const overdue = (r.due_date as string) < today;
    if (r.type === "income") {
      t.receivable += v;
      if (overdue) t.overdueReceivable += v;
    } else {
      t.payable += v;
      if (overdue) t.overduePayable += v;
    }
    if (overdue) t.overdueCount++;
  }
  for (const k of ["receivable", "payable", "overdueReceivable", "overduePayable"] as const) t[k] = Math.round(t[k] * 100) / 100;
  return t;
}

export async function cashFlow(from: string, to: string) {
  await requireRole(FINANCE_ROLES);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("financial_transactions")
    .select("type, paid_at, paid_amount")
    .eq("status", "paid")
    .gte("paid_at", from)
    .lte("paid_at", to)
    .limit(20000);
  if (error) throw new Error("Não foi possível calcular o fluxo de caixa.");
  return buildCashFlow(
    data.map((r) => ({ type: r.type as TransactionType, paid_at: r.paid_at as string, paid_amount: Number(r.paid_amount) })),
    from,
    to,
  );
}

export async function saveTransaction(id: string | null, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  await requireRole(FINANCE_ROLES);
  const parsed = transactionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_save_transaction", {
    p_id: id,
    p_type: v.type,
    p_category_id: v.category_id,
    p_description: v.description,
    p_amount: v.amount,
    p_due_date: v.due_date,
    p_competence_date: v.competence_date,
    p_supplier_id: v.supplier_id,
    p_customer_id: v.customer_id,
    p_notes: v.notes,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: id ? "Lançamento atualizado." : "Lançamento criado.", data: { id: data as string } };
}

export async function settleTransaction(input: Record<string, unknown>): Promise<ActionResult> {
  await requireRole(FINANCE_ROLES);
  const parsed = settleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_settle_transaction", {
    p_id: parsed.data.id,
    p_paid_at: parsed.data.paid_at,
    p_amount: parsed.data.amount,
    p_method: parsed.data.method,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Lançamento liquidado." };
}

export async function setTransactionStatus(id: string, status: "open" | "canceled"): Promise<ActionResult> {
  await requireRole(FINANCE_ROLES);
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_set_transaction_status", { p_id: id, p_status: status });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: status === "open" ? "Liquidação desfeita." : "Lançamento cancelado." };
}

export async function createPurchasePayable(input: Record<string, unknown>): Promise<ActionResult> {
  await requireRole(FINANCE_ROLES);
  const parsed = payableSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_create_purchase_payable", {
    p_order_id: parsed.data.order_id,
    p_amount: parsed.data.amount,
    p_due_date: parsed.data.due_date,
    p_description: parsed.data.description,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Conta a pagar lançada no financeiro." };
}
