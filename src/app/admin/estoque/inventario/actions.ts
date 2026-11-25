"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { parseDecimal } from "@/modules/inventory/domain";
import {
  applyInventoryCount,
  cancelInventoryCount,
  createInventoryCount,
  setCountedQuantity,
} from "@/modules/inventory/service";

export async function createCountAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const scope = String(formData.get("scope") ?? "all");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const result = await createInventoryCount(scope, notes);
  if (!result.ok) return result;
  redirect(`/admin/estoque/inventario/${result.data.id}`);
}

export async function saveCountedAction(itemId: string, raw: string): Promise<ActionResult> {
  const value = raw.trim() === "" ? null : parseDecimal(raw);
  if (value !== null && (Number.isNaN(value) || value < 0)) return { ok: false, error: "Quantidade inválida." };
  return setCountedQuantity(itemId, value);
}

export async function applyCountAction(id: string): Promise<ActionResult> {
  const result = await applyInventoryCount(id);
  if (result.ok) {
    revalidatePath("/admin/estoque", "layout");
    revalidatePath("/admin/movimentacoes");
    revalidatePath("/admin");
  }
  return result.ok ? { ok: true, message: result.message } : result;
}

export async function cancelCountAction(id: string): Promise<ActionResult> {
  const result = await cancelInventoryCount(id);
  if (result.ok) revalidatePath("/admin/estoque/inventario", "layout");
  return result;
}
