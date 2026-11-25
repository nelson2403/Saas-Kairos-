"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { receivePurchase, reverseReceipt, savePurchaseOrder, setPurchaseStatus, type ReceiveActionResult } from "@/modules/purchasing/service";

function revalidatePurchases(withStock = false) {
  revalidatePath("/admin/compras", "layout");
  revalidatePath("/admin/fornecedores", "layout");
  revalidatePath("/admin");
  if (withStock) {
    revalidatePath("/admin/estoque", "layout");
    revalidatePath("/admin/movimentacoes", "layout");
    revalidatePath("/admin/materias-primas", "layout");
    revalidatePath("/admin/produtos", "layout");
    revalidatePath("/admin/producao", "layout");
  }
}

export async function savePurchaseOrderAction(input: unknown): Promise<ActionResult> {
  const result = await savePurchaseOrder(input);
  if (!result.ok) return result;
  revalidatePurchases();
  redirect(`/admin/compras/${result.data.order_id}?salvo=1`);
}

export async function setPurchaseStatusAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await setPurchaseStatus(Object.fromEntries(formData));
  if (result.ok) revalidatePurchases();
  return result;
}

export async function receivePurchaseAction(input: unknown): Promise<ReceiveActionResult> {
  const result = await receivePurchase(input);
  if (result.ok) revalidatePurchases(true);
  return result;
}

export async function reverseReceiptAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await reverseReceipt(Object.fromEntries(formData));
  if (result.ok) revalidatePurchases(true);
  return result;
}
