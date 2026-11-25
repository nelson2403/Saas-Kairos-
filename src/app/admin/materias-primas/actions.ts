"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { saveRawMaterial } from "@/modules/inventory/service";

export async function saveRawMaterialAction(
  id: string | null,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const result = await saveRawMaterial(id, Object.fromEntries(formData));
  if (!result.ok) return result;
  revalidatePath("/admin/materias-primas", "layout");
  revalidatePath("/admin/estoque");
  if (!id) redirect(`/admin/materias-primas/${result.data.id}?criado=1`);
  return { ok: true, message: result.message };
}
