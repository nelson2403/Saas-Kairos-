"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { registerMovement, reverseMovement, type MovementActionResult } from "@/modules/inventory/service";

function revalidateStock() {
  revalidatePath("/admin/estoque", "layout");
  revalidatePath("/admin/movimentacoes", "layout");
  revalidatePath("/admin/produtos", "layout");
  revalidatePath("/admin/materias-primas", "layout");
  revalidatePath("/admin");
}

export async function registerMovementAction(input: Record<string, string>): Promise<MovementActionResult> {
  const result = await registerMovement(input);
  if (result.ok) revalidateStock();
  return result;
}

export async function reverseMovementAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await reverseMovement(Object.fromEntries(formData));
  if (result.ok) revalidateStock();
  return result;
}
