"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { anonymizeCustomer, saveCustomer } from "@/modules/partners/service";

export async function saveCustomerAction(id: string | null, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await saveCustomer(id, Object.fromEntries(formData));
  if (!result.ok) return result;
  revalidatePath("/admin/clientes", "layout");
  if (!id) redirect(`/admin/clientes/${result.data.id}?criado=1`);
  return { ok: true, message: result.message };
}

export async function anonymizeCustomerAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await anonymizeCustomer(Object.fromEntries(formData));
  if (result.ok) revalidatePath("/admin/clientes", "layout");
  return result;
}
