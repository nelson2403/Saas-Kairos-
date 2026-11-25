import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireMembership, requireRole, type RoleKey } from "@/lib/auth/dal";
import { dbErrorMessage, isConflict, toFieldErrors, type ActionResult } from "@/lib/action-result";
import { CATALOG_ROLES, STOCK_ROLES } from "@/modules/inventory/service";
import type { PurchaseStatus } from "./domain";
import { purchaseOrderSchema, receiveSchema, reverseReceiptSchema, statusSchema } from "./schemas";

/** Quem cria/edita pedidos, muda situação e estorna recebimentos. */
export const canManagePurchases = (role: RoleKey) => CATALOG_ROLES.includes(role);
/** Quem recebe mercadoria (conferência na chegada). */
export const canReceive = (role: RoleKey) => STOCK_ROLES.includes(role);

export const PURCHASES_PAGE_SIZE = 50;

export type PurchaseListItem = {
  id: string;
  number: number;
  status: PurchaseStatus;
  total: string;
  expected_date: string | null;
  created_at: string;
  supplier: { id: string; name: string };
};

const GROUPS: Record<string, PurchaseStatus[]> = {
  abertos: ["draft", "ordered", "partial"],
  recebidos: ["received", "closed"],
  cancelados: ["canceled"],
};

export async function listPurchaseOrders(filters: { group?: string; supplierId?: string; page?: number }) {
  await requireMembership();
  const supabase = await createClient();
  const page = Math.max(1, filters.page ?? 1);
  let query = supabase
    .from("purchase_orders")
    .select("id, number, status, total, expected_date, created_at, supplier:suppliers(id, name)", { count: "exact" })
    .order("number", { ascending: false })
    .range((page - 1) * PURCHASES_PAGE_SIZE, page * PURCHASES_PAGE_SIZE - 1);
  const statuses = filters.group ? GROUPS[filters.group] : undefined;
  if (statuses) query = query.in("status", statuses);
  if (filters.supplierId) query = query.eq("supplier_id", filters.supplierId);
  const { data, error, count } = await query;
  if (error) throw new Error("Não foi possível carregar os pedidos de compra.");
  return { rows: data as unknown as PurchaseListItem[], total: count ?? 0, page };
}

export async function countPendingPurchases() {
  await requireMembership();
  const supabase = await createClient();
  const { count } = await supabase.from("purchase_orders").select("id", { count: "exact", head: true }).in("status", ["ordered", "partial"]);
  return count ?? 0;
}

export type PurchaseOrderItem = {
  id: string;
  product_id: string | null;
  raw_material_id: string | null;
  quantity: string;
  unit_id: string;
  unit_price: string;
  received_quantity: string;
  sort_order: number;
  unit: { code: string };
  product: { id: string; name: string; unit: { code: string } } | null;
  raw_material: { id: string; name: string; unit: { code: string } } | null;
};

export type PurchaseReceipt = {
  id: string;
  invoice_number: string | null;
  notes: string | null;
  status: "active" | "reversed";
  reverse_reason: string | null;
  created_at: string;
  created_by: string | null;
  reversed_at: string | null;
  reversed_by: string | null;
  items: { order_item_id: string; quantity: string; unit_price: string }[];
};

export type PurchaseOrderDetail = PurchaseListItem & {
  notes: string | null;
  close_reason: string | null;
  ordered_at: string | null;
  closed_at: string | null;
  created_by: string | null;
  closed_by: string | null;
  items: PurchaseOrderItem[];
  receipts: PurchaseReceipt[];
  people: Record<string, string>;
};

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderDetail | null> {
  await requireMembership();
  const supabase = await createClient();
  const [{ data: order }, { data: receipts }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select(
        "id, number, status, total, expected_date, notes, close_reason, created_at, ordered_at, closed_at, created_by, closed_by, " +
          "supplier:suppliers(id, name), " +
          "items:purchase_order_items(id, product_id, raw_material_id, quantity, unit_id, unit_price, received_quantity, sort_order, unit:measurement_units(code), " +
          "product:products(id, name, unit:measurement_units(code)), raw_material:raw_materials(id, name, unit:measurement_units(code)))",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("purchase_receipts")
      .select("id, invoice_number, notes, status, reverse_reason, created_at, created_by, reversed_at, reversed_by, items:purchase_receipt_items(order_item_id, quantity, unit_price)")
      .eq("order_id", id)
      .order("created_at", { ascending: false }),
  ]);
  if (!order) return null;
  const detail = order as unknown as Omit<PurchaseOrderDetail, "receipts" | "people">;
  detail.items.sort((a, b) => a.sort_order - b.sort_order);
  const recs = (receipts ?? []) as unknown as PurchaseReceipt[];

  const ids = [detail.created_by, detail.closed_by, ...recs.flatMap((r) => [r.created_by, r.reversed_by])].filter(Boolean) as string[];
  const people: Record<string, string> = {};
  if (ids.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", [...new Set(ids)]);
    for (const p of profiles ?? []) if (p.full_name) people[p.id as string] = p.full_name as string;
  }
  return { ...detail, receipts: recs, people };
}

/** Pedido ao qual um recebimento pertence (links vindos das movimentações). */
export async function receiptOrderId(receiptId: string) {
  await requireMembership();
  const supabase = await createClient();
  const { data } = await supabase.from("purchase_receipts").select("order_id").eq("id", receiptId).maybeSingle();
  return (data?.order_id as string | undefined) ?? null;
}

export async function savePurchaseOrder(input: unknown): Promise<ActionResult<{ order_id: string; number: number }>> {
  await requireRole(CATALOG_ROLES);
  const parsed = purchaseOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_save_purchase_order", {
    p_client_op_id: v.op_id,
    p_order_id: v.order_id,
    p_supplier_id: v.supplier_id,
    p_expected_date: v.expected_date,
    p_notes: v.notes,
    p_items: v.items,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: v.order_id ? "Pedido atualizado." : "Pedido criado.", data: data as { order_id: string; number: number } };
}

export async function setPurchaseStatus(input: Record<string, unknown>): Promise<ActionResult> {
  await requireRole(CATALOG_ROLES);
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_set_purchase_order_status", {
    p_order_id: parsed.data.order_id,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  const msg = { ordered: "Pedido marcado como enviado ao fornecedor.", canceled: "Pedido cancelado.", closed: "Saldo pendente encerrado." };
  return { ok: true, message: msg[parsed.data.status] };
}

export type ReceiveActionResult =
  | { ok: true; message: string; data: { receipt_id: string; status: PurchaseStatus; duplicate?: boolean } }
  | { ok: false; error?: string; fieldErrors?: Record<string, string>; conflict?: boolean };

export async function receivePurchase(input: unknown): Promise<ReceiveActionResult> {
  await requireRole(STOCK_ROLES);
  const parsed = receiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_receive_purchase", {
    p_client_op_id: v.op_id,
    p_order_id: v.order_id,
    p_items: v.items,
    p_invoice_number: v.invoice_number,
    p_notes: v.notes,
  });
  if (error) return { ok: false, error: dbErrorMessage(error), conflict: isConflict(error) };
  const result = data as { receipt_id: string; status: PurchaseStatus; duplicate?: boolean };
  return {
    ok: true,
    message: result.duplicate ? "Este recebimento já havia sido registrado." : "Recebimento registrado: estoque atualizado.",
    data: result,
  };
}

export async function reverseReceipt(input: Record<string, unknown>): Promise<ActionResult> {
  await requireRole(CATALOG_ROLES);
  const parsed = reverseReceiptSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_reverse_purchase_receipt", {
    p_client_op_id: parsed.data.op_id,
    p_receipt_id: parsed.data.receipt_id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, message: "Recebimento estornado: estoque ajustado." };
}
