"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { saveSupplier } from "@/modules/partners/service";

export async function saveSupplierAction(id: string | null, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await saveSupplier(id, Object.fromEntries(formData));
  if (!result.ok) return result;
  revalidatePath("/admin/fornecedores", "layout");
  revalidatePath("/admin/compras", "layout");
  if (!id) redirect(`/admin/fornecedores/${result.data.id}?criado=1`);
  return { ok: true, message: result.message };
}
