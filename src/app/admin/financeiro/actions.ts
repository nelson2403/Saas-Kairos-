"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { createCategory, createPurchasePayable, saveTransaction, setTransactionStatus, settleTransaction } from "@/modules/finance/service";

function revalidateFinance() {
  revalidatePath("/admin/financeiro", "layout");
  revalidatePath("/admin/relatorios", "layout");
  revalidatePath("/admin/compras", "layout");
  revalidatePath("/admin");
}

export async function saveTransactionAction(id: string | null, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await saveTransaction(id, Object.fromEntries(formData));
  if (!result.ok) return result;
  revalidateFinance();
  if (!id) redirect(`/admin/financeiro?ver=${formData.get("type") === "income" ? "receber" : "pagar"}`);
  return { ok: true, message: result.message };
}

export async function settleTransactionAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await settleTransaction(Object.fromEntries(formData));
  if (result.ok) revalidateFinance();
  return result;
}

export async function setTransactionStatusAction(id: string, status: "open" | "canceled"): Promise<ActionResult> {
  const result = await setTransactionStatus(id, status);
  if (result.ok) revalidateFinance();
  return result;
}

export async function createCategoryAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await createCategory(Object.fromEntries(formData));
  if (result.ok) revalidatePath("/admin/financeiro", "layout");
  return result;
}

export async function createPurchasePayableAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await createPurchasePayable(Object.fromEntries(formData));
  if (result.ok) revalidateFinance();
  return result;
}
