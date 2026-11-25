"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import {
  cancelOrder,
  completeOrder,
  createOrder,
  deactivateRecipe,
  reverseOrder,
  saveRecipe,
  type CompleteActionResult,
} from "@/modules/production/service";

function revalidateProduction() {
  revalidatePath("/admin/producao", "layout");
  revalidatePath("/admin/estoque", "layout");
  revalidatePath("/admin/movimentacoes", "layout");
  revalidatePath("/admin/produtos", "layout");
  revalidatePath("/admin/materias-primas", "layout");
  revalidatePath("/admin");
}

export async function saveRecipeAction(input: unknown): Promise<ActionResult<{ version: number }>> {
  const result = await saveRecipe(input);
  if (result.ok) {
    revalidatePath("/admin/producao", "layout");
    revalidatePath("/admin/produtos", "layout");
  }
  return result;
}

export async function deactivateRecipeAction(productId: string): Promise<ActionResult> {
  const result = await deactivateRecipe(productId);
  if (result.ok) revalidatePath("/admin/producao", "layout");
  return result;
}

export async function createOrderAction(input: Record<string, string>): Promise<ActionResult> {
  const result = await createOrder(input);
  if (!result.ok) return result;
  revalidatePath("/admin/producao", "layout");
  redirect(`/admin/producao/${result.data.order_id}?aberta=1`);
}

export async function completeOrderAction(input: unknown): Promise<CompleteActionResult> {
  const result = await completeOrder(input);
  if (result.ok) revalidateProduction();
  return result;
}

export async function cancelOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await cancelOrder(Object.fromEntries(formData));
  if (result.ok) revalidatePath("/admin/producao", "layout");
  return result;
}

export async function reverseOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await reverseOrder(Object.fromEntries(formData));
  if (result.ok) revalidateProduction();
  return result;
}
