"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { cancelOrder, createOrder, markDelivered, payOrder, refundOrder } from "@/modules/sales/service";

function revalidateSales() {
  for (const p of ["/admin/pedidos", "/admin/vendas", "/admin/financeiro", "/admin/estoque", "/admin/movimentacoes", "/admin/produtos", "/admin/clientes", "/admin/relatorios"]) {
    revalidatePath(p, "layout");
  }
  revalidatePath("/admin");
}

export async function createOrderAction(input: unknown): Promise<ActionResult> {
  const result = await createOrder(input);
  if (!result.ok) return result;
  revalidateSales();
  redirect(`/admin/pedidos/${result.data.order_id}?novo=1`);
}

export async function payOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await payOrder(Object.fromEntries(formData));
  if (result.ok) revalidateSales();
  return result;
}

export async function cancelOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await cancelOrder(Object.fromEntries(formData));
  if (result.ok) revalidateSales();
  return result;
}

export async function markDeliveredAction(orderId: string): Promise<ActionResult> {
  const result = await markDelivered(orderId);
  if (result.ok) revalidateSales();
  return result;
}

export async function refundOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await refundOrder(Object.fromEntries(formData));
  if (result.ok) revalidateSales();
  return result;
}
